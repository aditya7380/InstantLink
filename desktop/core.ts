import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ShareStore } from '../src/store.js';
import { buildPublicServer } from '../src/server.js';
import { buildAdminServer } from '../src/admin.js';
import { loadOrCreateSecretKey } from '../src/secrets.js';
import { CloudflareTunnel, bindTunnelToConfig, type TunnelController } from '../src/tunnel.js';
import type { Config } from '../src/config.js';

export interface Backend {
  cfg: Config;
  store: ShareStore;
  tunnel: TunnelController;
  /** Local-only base (http://localhost:port). */
  localBase: string;
  call(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
}

const PREFERRED_PORT = 47821;

async function listenWithFallback(app: FastifyInstance, preferred: number): Promise<number> {
  try {
    await app.listen({ host: '127.0.0.1', port: preferred });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    await app.listen({ host: '127.0.0.1', port: 0 }); // port conflict -> pick a free one
  }
  return (app.server.address() as AddressInfo).port;
}

/**
 * Starts the public file server and an IN-PROCESS admin API. The admin API never opens a network port:
 * the desktop UI reaches it only through Electron IPC (via `call`), so no other program can use it.
 */
export async function startBackend(dataDir: string, opts: { preferredPort?: number; cloudflaredPath?: string; cloudflaredDirs?: string[] } = {}): Promise<Backend> {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const store = new ShareStore(path.join(dataDir, 'shares.json'), loadOrCreateSecretKey(dataDir));
  const pub = buildPublicServer(store);
  const port = await listenWithFallback(pub, opts.preferredPort ?? PREFERRED_PORT);
  const localBase = `http://localhost:${port}`;
  const cfg: Config = { dataDir, publicHost: '127.0.0.1', publicPort: port, adminPort: 0, publicBaseUrl: localBase };
  const tunnel = new CloudflareTunnel({ localPort: port, binary: opts.cloudflaredPath, extraDirs: opts.cloudflaredDirs });
  bindTunnelToConfig(cfg, tunnel, localBase);
  const adminKey = randomBytes(24).toString('base64url'); // lives only in memory
  const admin = buildAdminServer(store, cfg, adminKey, false, tunnel);
  await admin.ready();

  return {
    cfg, store, tunnel, localBase,
    async call(method, url, payload) {
      const r = await admin.inject({ method, url, payload: payload as object | undefined, headers: { host: 'localhost', 'x-admin-key': adminKey } });
      let body: unknown;
      try { body = r.json(); } catch { body = r.body; }
      return { status: r.statusCode, body };
    },
    async close() {
      await tunnel.stop();
      await pub.close();
      await admin.close();
    },
  };
}

/* ---------- Validation of everything that arrives over IPC (the renderer is untrusted) ---------- */

export const EXPIRY_CHOICES = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400, never: null } as const;
export type ExpiryChoice = keyof typeof EXPIRY_CHOICES;

export interface CreateRequest { path: string; expiry: ExpiryChoice; allowDownload: boolean }

export function validateCreateRequest(x: unknown): CreateRequest {
  if (typeof x !== 'object' || x === null) throw new Error('Invalid request.');
  const o = x as Record<string, unknown>;
  if (typeof o.path !== 'string' || !path.isAbsolute(o.path) || o.path.includes('\0') || o.path.length > 4096) throw new Error('Please choose a file or folder first.');
  if (typeof o.expiry !== 'string' || !(o.expiry in EXPIRY_CHOICES)) throw new Error('Invalid expiry choice.');
  if (typeof o.allowDownload !== 'boolean') throw new Error('Invalid download setting.');
  return { path: o.path, expiry: o.expiry as ExpiryChoice, allowDownload: o.allowDownload };
}

export function validateId(x: unknown): string {
  if (typeof x !== 'string' || !/^[0-9a-f]{16}$/.test(x)) throw new Error('Invalid share id.');
  return x;
}

export function validateExpiryChoice(x: unknown): ExpiryChoice {
  if (typeof x !== 'string' || !(x in EXPIRY_CHOICES)) throw new Error('Invalid expiry choice.');
  return x as ExpiryChoice;
}

/** Only links that point at our own current public base may be opened/copied. */
export function isOurLink(url: string, cfg: Config, localBase: string): boolean {
  return url.startsWith(`${cfg.publicBaseUrl}/s/`) || url.startsWith(`${localBase}/s/`);
}
