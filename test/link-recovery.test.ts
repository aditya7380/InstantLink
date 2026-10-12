import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEnv, writeRandom, type Env } from './helpers.js';
import { ShareStore } from '../src/store.js';
import { decryptText, encryptText, loadOrCreateSecretKey } from '../src/secrets.js';

let env: Env;
let file: string;
beforeAll(async () => {
  env = await makeEnv();
  file = path.join(env.dir, 'v.mp4');
  writeRandom(file, 500);
});
afterAll(() => env.close());

const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  env.admin.inject({ method, url, payload: payload as object, headers: { host: 'localhost', 'x-admin-key': env.adminKey } });

describe('secure link recovery', () => {
  it('owner can fetch the same working link again, only via the admin API', async () => {
    const created = (await call('POST', '/api/shares', { path: file })).json();
    expect(created.linkAvailable).toBe(true);
    const again = (await call('GET', `/api/shares/${created.id}/link`)).json();
    expect(again.url).toBe(created.url);
    expect((await fetch(again.url)).status).toBe(200);
    const listed = (await call('GET', '/api/shares')).json().find((s: { id: string }) => s.id === created.id);
    expect(JSON.stringify(listed)).not.toContain(created.url.split('/s/')[1]); // list never contains the token
  });

  it('the raw token is not in shares.json, even in encrypted-at-rest mode', async () => {
    const created = (await call('POST', '/api/shares', { path: file })).json();
    const token = created.url.split('/s/')[1];
    const disk = fs.readFileSync(path.join(env.dir, 'shares.json'), 'utf8');
    expect(disk).not.toContain(token);
    expect(disk).toContain('tokenEnc');
  });

  it('refuses to reveal a revoked or expired link', async () => {
    const c = (await call('POST', '/api/shares', { path: file })).json();
    await call('POST', `/api/shares/${c.id}/revoke`);
    const r = await call('GET', `/api/shares/${c.id}/link`);
    expect(r.statusCode).toBe(410);
    expect(r.body).not.toContain('/s/');
    const e = (await call('POST', '/api/shares', { path: file, expiresInSeconds: 1 })).json();
    env.store.setExpiry(e.id, Date.now() - 1);
    expect((await call('GET', `/api/shares/${e.id}/link`)).statusCode).toBe(410);
  });

  it('requires the admin key and 404s unknown ids', async () => {
    const noKey = await env.admin.inject({ method: 'GET', url: '/api/shares/abc/link', headers: { host: 'localhost' } });
    expect(noKey.statusCode).toBe(401);
    expect((await call('GET', '/api/shares/nope/link')).statusCode).toBe(404);
  });

  it('survives restart with the same key; a wrong key cannot reveal anything', async () => {
    const c = (await call('POST', '/api/shares', { path: file })).json();
    const dir2 = fs.mkdtempSync(path.join(env.dir, 'k-'));
    const key = loadOrCreateSecretKey(dir2);
    const s1 = new ShareStore(path.join(dir2, 'shares.json'), key);
    const made = s1.create({ kind: 'file', sourcePath: file, displayName: 'v.mp4', sizeAtCreate: 500, mtimeMsAtCreate: 1, expiresAt: null, allowDownload: true });
    const s2 = new ShareStore(path.join(dir2, 'shares.json'), loadOrCreateSecretKey(dir2));
    expect(s2.revealToken(made.share.id)).toBe(made.token);
    const s3 = new ShareStore(path.join(dir2, 'shares.json'), randomBytes(32));
    expect(s3.revealToken(made.share.id)).toBeNull();
    expect(c.id).toBeTruthy();
  });

  it('secret.key is created with owner-only permissions', () => {
    const d = fs.mkdtempSync(path.join(env.dir, 'perm-'));
    loadOrCreateSecretKey(d);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(d, 'secret.key')).mode & 0o077).toBe(0);
  });

  it('detects tampered ciphertext', () => {
    const key = randomBytes(32);
    const enc = encryptText(key, 'hello');
    expect(decryptText(key, enc)).toBe('hello');
    const raw = Buffer.from(enc, 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(decryptText(key, raw.toString('base64'))).toBeNull();
  });

  it('old records without tokenEnc report link not recoverable (migration)', async () => {
    const dir = fs.mkdtempSync(path.join(env.dir, 'old-'));
    const f = path.join(dir, 'shares.json');
    fs.writeFileSync(f, JSON.stringify({ shares: [{ id: 'old1', tokenHash: 'x', kind: 'file', sourcePath: file, displayName: 'v.mp4', sizeAtCreate: 500, mtimeMsAtCreate: 1, createdAt: 1, expiresAt: null, revokedAt: null, allowDownload: true, mode: 'local' }] }));
    const s = new ShareStore(f, randomBytes(32));
    expect(s.get('old1')?.tokenEnc).toBeNull();
    expect(s.revealToken('old1')).toBeNull();
  });
});
