import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { safeEqual } from './tokens.js';
import { shareState, type Share, type ShareStore } from './store.js';
import { verifyShareUrl } from './verify.js';
import { isTooBroadFolder } from './winsafe.js';
import os from 'node:os';
import { safeDisplayName } from './html.js';
import type { TunnelController } from './tunnel.js';

export function loadOrCreateAdminKey(dataDir: string): string {
  const file = path.join(dataDir, 'admin-key');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const key = randomBytes(24).toString('base64url');
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function view(s: Share, cfg: Config) {
  return {
    id: s.id,
    name: s.displayName,
    kind: s.kind,
    state: shareState(s),
    mode: s.mode,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    allowDownload: s.allowDownload,
    sizeBytes: s.sizeAtCreate,
    sourceLocation: s.sourcePath, // owner-only API; never exposed on the public server
    linkAvailable: s.tokenEnc !== null && s.revokedAt === null,
    availability: 'Works only while this computer is on, online, and InstantLink is running.',
    publicBaseIsLocal: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(cfg.publicBaseUrl),
  };
}

interface CreateBody { path?: unknown; expiresInSeconds?: unknown; allowDownload?: unknown; verify?: unknown }

export function buildAdminServer(store: ShareStore, cfg: Config, adminKey: string, logger = false, tunnel: TunnelController | null = null): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 16 * 1024 });
  const allowedHosts = new Set([`localhost:${cfg.adminPort}`, `127.0.0.1:${cfg.adminPort}`, `[::1]:${cfg.adminPort}`]);

  app.addHook('onRequest', async (req, reply) => {
    // DNS-rebinding defence: only answer when addressed as localhost.
    // (adminPort 0 = tests that pick a random port; skip the port part there.)
    const host = (req.headers.host ?? '').toLowerCase();
    const hostOk = cfg.adminPort === 0 ? /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) : allowedHosts.has(host);
    if (!hostOk) return reply.code(403).send({ error: 'bad_host' });
    const key = req.headers['x-admin-key'];
    if (typeof key !== 'string' || !safeEqual(key, adminKey)) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.post('/api/shares', async (req, reply) => {
    const b = (req.body ?? {}) as CreateBody;
    if (typeof b.path !== 'string' || b.path.length === 0 || b.path.includes('\0') || !path.isAbsolute(b.path)) {
      return reply.code(400).send({ error: 'invalid_path', message: 'path must be an absolute path to a file or folder' });
    }
    let expiresAt: number | null = null;
    if (b.expiresInSeconds !== undefined && b.expiresInSeconds !== null) {
      if (typeof b.expiresInSeconds !== 'number' || !Number.isFinite(b.expiresInSeconds) || b.expiresInSeconds <= 0 || b.expiresInSeconds > 365 * 86400) {
        return reply.code(400).send({ error: 'invalid_expiry', message: 'expiresInSeconds must be between 1 and 31536000' });
      }
      expiresAt = Date.now() + Math.round(b.expiresInSeconds * 1000);
    }
    if (b.allowDownload !== undefined && typeof b.allowDownload !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_allow_download' });
    }
    let real: string;
    let st: fs.Stats;
    try {
      real = await fsp.realpath(b.path);
      st = await fsp.stat(real);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return reply.code(code === 'EACCES' ? 403 : 404).send({
        error: code === 'EACCES' ? 'permission_denied' : 'not_found',
        message: code === 'EACCES' ? 'InstantLink is not allowed to read that location.' : 'That file or folder does not exist.',
      });
    }
    if (!st.isFile() && !st.isDirectory()) return reply.code(400).send({ error: 'unsupported_type' });
    if (st.isDirectory() && isTooBroadFolder(real, os.homedir())) {
      return reply.code(400).send({ error: 'folder_too_broad', message: 'That folder is too broad (a whole drive, your user folder, or a folder containing it). Choose a specific folder, or share one file.' });
    }
    const { share, token } = store.create({
      kind: st.isDirectory() ? 'folder' : 'file',
      sourcePath: real,
      displayName: safeDisplayName(path.basename(real)),
      sizeAtCreate: st.isFile() ? st.size : null,
      mtimeMsAtCreate: st.isFile() ? st.mtimeMs : null,
      expiresAt,
      allowDownload: b.allowDownload ?? true,
    });
    const url = `${cfg.publicBaseUrl}/s/${token}`;
    const out: Record<string, unknown> = { ...view(share, cfg), url, uploadedToCloud: false };
    if (b.verify === true) out.verification = await verifyShareUrl(url, share);
    return reply.code(201).send(out);
  });

  app.get('/api/shares', async () => store.list().map((s) => view(s, cfg)));

  /** What can a recipient reach right now? Never claims more than was checked. */
  app.get('/api/status', async () => ({
    publicBaseUrl: cfg.publicBaseUrl,
    publicBaseIsLocal: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(cfg.publicBaseUrl),
    tunnel: tunnel ? tunnel.status() : null,
  }));

  app.post('/api/tunnel/start', async (_req, reply) => {
    if (!tunnel) return reply.code(501).send({ error: 'tunnel_unavailable' });
    return tunnel.start();
  });

  app.post('/api/tunnel/stop', async (_req, reply) => {
    if (!tunnel) return reply.code(501).send({ error: 'tunnel_unavailable' });
    await tunnel.stop();
    return tunnel.status();
  });

  /** Owner-only: get the link of an active share again. */
  app.get<{ Params: { id: string } }>('/api/shares/:id/link', async (req, reply) => {
    const s = store.get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'not_found' });
    if (shareState(s) !== 'active') return reply.code(410).send({ error: shareState(s), message: 'This link is no longer active.' });
    const token = store.revealToken(s.id);
    if (!token) return reply.code(409).send({ error: 'link_not_recoverable', message: 'This link was created before link recovery existed. Create a new link.' });
    return { url: `${cfg.publicBaseUrl}/s/${token}` };
  });

  app.post<{ Params: { id: string } }>('/api/shares/:id/revoke', async (req, reply) => {
    const s = store.revoke(req.params.id);
    return s ? view(s, cfg) : reply.code(404).send({ error: 'not_found' });
  });

  app.post<{ Params: { id: string }; Body: { expiresInSeconds?: number | null } }>('/api/shares/:id/expiry', async (req, reply) => {
    const v = (req.body ?? {}).expiresInSeconds;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 365 * 86400)) {
      return reply.code(400).send({ error: 'invalid_expiry' });
    }
    const s = store.setExpiry(req.params.id, v === null ? null : Date.now() + Math.round(v * 1000));
    return s ? view(s, cfg) : reply.code(404).send({ error: 'not_found' });
  });

  /** Verify a link the owner already has. The URL must be on our configured public address (no open proxy / SSRF). */
  app.post<{ Body: { url?: string } }>('/api/verify', async (req, reply) => {
    const url = req.body?.url;
    if (typeof url !== 'string' || !url.startsWith(`${cfg.publicBaseUrl}/s/`)) {
      return reply.code(400).send({ error: 'invalid_url', message: 'URL must start with your configured public address.' });
    }
    const token = url.slice(`${cfg.publicBaseUrl}/s/`.length).split(/[/?#]/)[0] ?? '';
    const share = store.findByToken(token);
    if (!share) return reply.code(404).send({ error: 'not_found' });
    return verifyShareUrl(`${cfg.publicBaseUrl}/s/${token}`, share);
  });

  return app;
}
