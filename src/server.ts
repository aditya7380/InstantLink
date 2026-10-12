import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { contentTypeFor, isPlayable } from './mime.js';
import { parseRange } from './range.js';
import { PathError, resolveInside, statFile } from './paths.js';
import { isHiddenName } from './winsafe.js';
import { shareState, type Share, type ShareStore } from './store.js';
import { errorPage, esc, formatSize, formatUtc, layout, safeDisplayName } from './html.js';

/**
 * Rate-limit key. Behind the tunnel every visitor reaches us from 127.0.0.1, so we trust
 * CF-Connecting-IP ONLY when the TCP peer is loopback (i.e. our own cloudflared process).
 * Anyone else (LAN/Internet) cannot make us believe a different address.
 */
export function clientKey(remoteAddress: string | undefined, header: string | string[] | undefined, fallbackIp: string): string {
  const loop = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (loop && typeof header === 'string' && header.length <= 45 && /^[0-9a-fA-F:.]+$/.test(header)) return header;
  return fallbackIp;
}

export function redactUrl(url: string): string {
  return url.replace(/(\/s\/)[^/?#]+/, '$1[redacted]');
}

export interface PublicOptions {
  logger?: boolean;
  /** requests per minute per IP; 0 disables */
  rateLimitMax?: number;
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const safe = safeDisplayName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function fail(reply: FastifyReply, status: number, code: string, wantsHtml: boolean, heading: string, detail: string) {
  reply.headers(SECURITY_HEADERS);
  if (wantsHtml) {
    return reply.code(status).header('Content-Security-Policy', PAGE_CSP).type('text/html; charset=utf-8').send(errorPage(heading, detail));
  }
  return reply.code(status).send({ error: code });
}

type Lookup = { ok: true; share: Share } | { ok: false; status: number; code: string; heading: string; detail: string };

function lookup(store: ShareStore, token: string): Lookup {
  const share = store.findByToken(token);
  if (!share) return { ok: false, status: 404, code: 'not_found', heading: 'Link not found', detail: 'This link is not valid. Check that it was copied completely.' };
  const state = shareState(share);
  if (state === 'revoked') return { ok: false, status: 410, code: 'revoked', heading: 'Link revoked', detail: 'The owner has turned this link off.' };
  if (state === 'expired') return { ok: false, status: 410, code: 'expired', heading: 'Link expired', detail: 'This link has expired. Ask the owner for a new one.' };
  return { ok: true, share };
}

function mapPathError(e: unknown) {
  if (e instanceof PathError) {
    if (e.code === 'missing' || e.code === 'not_file') return { status: 404, code: 'file_unavailable', heading: 'File unavailable', detail: 'The file could not be found. The owner may have moved it, or their computer may be offline.' };
    if (e.code === 'denied') return { status: 503, code: 'file_unavailable', heading: 'File unavailable', detail: 'The file could not be read right now. Please try again later.' };
    return { status: 404, code: 'not_found', heading: 'Link not found', detail: 'This link is not valid.' };
  }
  throw e;
}

/** Resolve which real file on disk a request is allowed to read. */
async function authorizedFile(share: Share, relPath: string | null): Promise<{ real: string; size: number; mtimeMs: number; name: string }> {
  if (share.kind === 'file') {
    // Source must still be exactly the file that was shared (no symlink swap).
    let real: string;
    try {
      real = await fsp.realpath(share.sourcePath);
    } catch {
      throw new PathError('missing', 'missing');
    }
    if (real !== share.sourcePath) throw new PathError('outside', 'source changed');
    const st = await statFile(real);
    if (share.sizeAtCreate !== null && (st.size !== share.sizeAtCreate || Math.trunc(st.mtimeMs) !== Math.trunc(share.mtimeMsAtCreate ?? -1))) {
      throw new PathError('invalid', 'changed');
    }
    return { real, ...st, name: share.displayName };
  }
  if (!relPath) throw new PathError('invalid', 'no path');
  if (relPath.split('/').some((s) => isHiddenName(s))) throw new PathError('invalid', 'hidden');
  const real = await resolveInside(share.sourcePath, relPath);
  const st = await statFile(real);
  return { real, ...st, name: path.basename(real) };
}

async function streamFile(req: FastifyRequest, reply: FastifyReply, share: Share, relPath: string | null) {
  const download = (req.query as Record<string, string | undefined>).download === '1';
  if (download && !share.allowDownload) return fail(reply, 403, 'download_disabled', false, '', '');

  let f;
  try {
    f = await authorizedFile(share, relPath);
  } catch (e) {
    if (e instanceof PathError && e.message === 'changed') {
      return fail(reply, 409, 'file_changed', false, '', '');
    }
    const m = mapPathError(e);
    return fail(reply, m.status, m.code, false, m.heading, m.detail);
  }

  const type = contentTypeFor(f.name);
  const range = parseRange(req.headers.range, f.size);
  reply.headers(SECURITY_HEADERS);
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', type);
  reply.header('Last-Modified', new Date(f.mtimeMs).toUTCString());
  reply.header('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', f.name));

  if (range.kind === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${f.size}`).send();
  }
  let start = 0;
  let end = f.size - 1;
  if (range.kind === 'partial') {
    start = range.start;
    end = range.end;
    reply.code(206).header('Content-Range', `bytes ${start}-${end}/${f.size}`);
  }
  const length = f.size === 0 ? 0 : end - start + 1;
  reply.header('Content-Length', length);
  if (req.method === 'HEAD') {
    // Fastify resets Content-Length to 0 for body-less sends, so write the head ourselves.
    reply.hijack();
    reply.raw.writeHead(reply.statusCode, reply.getHeaders() as Record<string, string | number>);
    reply.raw.end();
    return;
  }
  if (length === 0) return reply.send();

  const stream = fs.createReadStream(f.real, { start, end });
  // Stop reading the moment the viewer disconnects (cancellation + backpressure via pipe).
  req.raw.on('close', () => stream.destroy());
  stream.on('error', (err) => {
    req.log.warn({ code: (err as NodeJS.ErrnoException).code }, 'file read failed mid-stream');
    reply.raw.destroy();
  });
  return reply.send(stream);
}

async function listFolder(root: string, limit = 2000): Promise<{ rel: string; size: number }[]> {
  const out: { rel: string; size: number }[] = [];
  async function walk(dir: string, prefix: string) {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= limit) return;
      if (isHiddenName(e.name) || e.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else if (e.isFile()) {
        try {
          out.push({ rel, size: (await fsp.stat(path.join(dir, e.name))).size });
        } catch { /* file vanished */ }
      }
    }
  }
  await walk(root, '');
  return out;
}

export function buildPublicServer(store: ShareStore, opts: PublicOptions = {}): FastifyInstance {
  const root = Fastify({
    logger: opts.logger ? { level: 'info', serializers: { req: (r) => ({ method: r.method, url: redactUrl(r.url) }) } } : false,
    bodyLimit: 1024,
    routerOptions: { maxParamLength: 512 },
    trustProxy: false, // never trust X-Forwarded-* unless a trusted gateway is configured
  });

  if (opts.rateLimitMax !== 0) {
    void root.register(rateLimit, {
      max: opts.rateLimitMax ?? 600,
      timeWindow: '1 minute',
      keyGenerator: (req) => clientKey(req.socket.remoteAddress, req.headers['cf-connecting-ip'], req.ip),
    });
  }

  // Routes live in a child plugin registered AFTER rate-limit, otherwise its onRoute hook misses them.
  void root.register(async (app) => {
  app.get('/healthz', async (_req, reply) => reply.send({ ok: true }));

  app.get<{ Params: { token: string } }>('/s/:token', async (req, reply) => {
    const r = lookup(store, req.params.token);
    if (!r.ok) return fail(reply, r.status, r.code, true, r.heading, r.detail);
    const share = r.share;
    reply.headers(SECURITY_HEADERS).header('Content-Security-Policy', PAGE_CSP).type('text/html; charset=utf-8');
    const expiry = share.expiresAt ? `Expires ${formatUtc(share.expiresAt)}` : 'No expiry set';
    const base = `/s/${encodeURIComponent(req.params.token)}`;

    if (share.kind === 'file') {
      let f;
      try {
        f = await authorizedFile(share, null);
      } catch (e) {
        if (e instanceof PathError && e.message === 'changed') return fail(reply, 409, 'file_changed', true, 'File changed', 'The owner changed this file after creating the link, so it is no longer served. Ask them for a new link.');
        const m = mapPathError(e);
        return fail(reply, m.status, m.code, true, m.heading, m.detail);
      }
      const kind = isPlayable(contentTypeFor(f.name));
      const player = kind
        ? `<${kind} controls preload="metadata" src="${base}/file"></${kind}>`
        : '<p>This file type has no preview.</p>';
      const dl = share.allowDownload ? `<a class="btn" href="${base}/file?download=1" download>Download</a>` : '';
      return reply.send(layout(share.displayName, `<div class="card"><h1>${esc(safeDisplayName(share.displayName))}</h1>
<p class="meta">${esc(formatSize(f.size))} · ${esc(expiry)}</p>${player}
<p class="meta">If the video does not play, your browser may not support its format. ${share.allowDownload ? 'You can download it instead.' : ''}</p>
${dl}<a class="btn alt" href="">Reload</a></div>`));
    }

    const files = await listFolder(share.sourcePath);
    const items = files
      .map((f) => `<li><a href="${base}/f/${f.rel.split('/').map(encodeURIComponent).join('/')}">${esc(f.rel.split('/').map(safeDisplayName).join('/'))}</a> <span class="meta">(${esc(formatSize(f.size))})</span></li>`)
      .join('');
    return reply.send(layout(share.displayName, `<div class="card"><h1>${esc(safeDisplayName(share.displayName))}</h1>
<p class="meta">${files.length} file(s) · ${esc(expiry)}</p>${files.length ? `<ul>${items}</ul>` : '<p>This folder is empty.</p>'}</div>`));
  });

  app.get<{ Params: { token: string } }>('/s/:token/file', async (req, reply) => {
    const r = lookup(store, req.params.token);
    if (!r.ok) return fail(reply, r.status, r.code, false, '', '');
    if (r.share.kind !== 'file') return fail(reply, 404, 'not_found', false, '', '');
    return streamFile(req, reply, r.share, null);
  });

  app.get<{ Params: { token: string; '*': string } }>('/s/:token/f/*', async (req, reply) => {
    const r = lookup(store, req.params.token);
    if (!r.ok) return fail(reply, r.status, r.code, false, '', '');
    if (r.share.kind !== 'folder') return fail(reply, 404, 'not_found', false, '', '');
    return streamFile(req, reply, r.share, req.params['*']);
  });

  });

  const app = root;
  app.setNotFoundHandler((_req, reply) => reply.headers(SECURITY_HEADERS).code(404).send({ error: 'not_found' }));
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ name: (err as Error).name }, 'request failed'); // no URL / token in the log
    const status = (err as { statusCode?: number }).statusCode;
    reply.headers(SECURITY_HEADERS).code(status && status < 500 ? status : 500).send({ error: status === 429 ? 'rate_limited' : 'internal_error' });
  });
  return root;
}
