import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ShareStore } from '../src/store.js';
import { buildPublicServer } from '../src/server.js';
import { buildAdminServer } from '../src/admin.js';
import type { Config } from '../src/config.js';

export interface Env {
  dir: string;
  store: ShareStore;
  base: string;
  cfg: Config;
  adminKey: string;
  admin: ReturnType<typeof buildAdminServer>;
  pub: ReturnType<typeof buildPublicServer>;
  close(): Promise<void>;
}

export async function makeEnv(opts: { rateLimitMax?: number } = {}): Promise<Env> {
  // realpath: macOS/Linux tmp dirs may themselves be symlinks
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'il-test-')));
  const secretKey = randomBytes(32);
  const store = new ShareStore(path.join(dir, 'shares.json'), secretKey);
  const pub = buildPublicServer(store, { rateLimitMax: opts.rateLimitMax ?? 0 });
  await pub.listen({ host: '127.0.0.1', port: 0 });
  const port = (pub.server.address() as AddressInfo).port;
  const base = `http://localhost:${port}`;
  const cfg: Config = { dataDir: dir, publicHost: '127.0.0.1', publicPort: port, adminPort: 0, publicBaseUrl: base };
  const adminKey = 'test-admin-key';
  const admin = buildAdminServer(store, cfg, adminKey);
  return {
    dir, store, base, cfg, adminKey, admin, pub,
    async close() {
      await pub.close();
      await admin.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function addShare(env: Env, p: string, extra: Partial<{ expiresAt: number | null; allowDownload: boolean }> = {}) {
  const real = fs.realpathSync(p);
  const st = fs.statSync(real);
  return env.store.create({
    kind: st.isDirectory() ? 'folder' : 'file',
    sourcePath: real,
    displayName: path.basename(real),
    sizeAtCreate: st.isFile() ? st.size : null,
    mtimeMsAtCreate: st.isFile() ? st.mtimeMs : null,
    expiresAt: extra.expiresAt ?? null,
    allowDownload: extra.allowDownload ?? true,
  });
}

export function writeRandom(file: string, bytes: number): Buffer {
  const buf = randomBytes(bytes);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

/** Send a request with an exact, un-normalized path (fetch() would collapse "..") */
export function rawGet(base: string, rawPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
