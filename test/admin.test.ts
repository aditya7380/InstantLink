import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEnv, writeRandom, type Env } from './helpers.js';
import { loadConfig } from '../src/config.js';

let env: Env;
let video: string;
beforeAll(async () => {
  env = await makeEnv();
  video = path.join(env.dir, 'clip.mp4');
  writeRandom(video, 50_000);
});
afterAll(() => env.close());

const call = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  env.admin.inject({ method, url, payload: payload as object, headers: { host: 'localhost', 'x-admin-key': env.adminKey, ...headers } });

describe('admin API protection', () => {
  it('rejects requests without the admin key', async () => {
    const r = await env.admin.inject({ method: 'GET', url: '/api/shares', headers: { host: 'localhost' } });
    expect(r.statusCode).toBe(401);
  });
  it('rejects a wrong key', async () => {
    expect((await call('GET', '/api/shares', undefined, { 'x-admin-key': 'wrong' })).statusCode).toBe(401);
  });
  it('rejects non-localhost Host headers (DNS rebinding)', async () => {
    expect((await call('GET', '/api/shares', undefined, { host: 'evil.example.com' })).statusCode).toBe(403);
  });
});

describe('create / list / revoke', () => {
  it('creates a link without any cloud upload and verifies the response', async () => {
    const r = await call('POST', '/api/shares', { path: video, verify: true });
    expect(r.statusCode).toBe(201);
    const j = r.json();
    expect(j.url).toMatch(new RegExp(`^${env.base}/s/[A-Za-z0-9_-]{43}$`));
    expect(j.uploadedToCloud).toBe(false);
    expect(j.kind).toBe('file');
    expect(j.verification.localFileAvailable).toBe(true);
    expect(j.verification.videoResponse).toBe('valid');
    expect(j.verification.publicRoute).toBe('local_only'); // honest: not proven reachable by others
    expect(j.verification.playback).toBe('not_tested');
    const page = await fetch(j.url);
    expect(page.status).toBe(200);
  });

  it('link creation is fast (does not read the file)', async () => {
    const big = path.join(env.dir, 'big.mp4');
    const fd = fs.openSync(big, 'w');
    fs.ftruncateSync(fd, 2 * 1024 ** 3); // 2 GB sparse
    fs.closeSync(fd);
    const t0 = performance.now();
    const r = await call('POST', '/api/shares', { path: big });
    const ms = performance.now() - t0;
    console.log(`link creation for a 2 GB file: ${ms.toFixed(1)} ms`);
    expect(r.statusCode).toBe(201);
    expect(ms).toBeLessThan(500);
  });

  it('never returns the link again in listings, and hides nothing it should show', async () => {
    const list = (await call('GET', '/api/shares')).json();
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s.url).toBeUndefined();
      expect(JSON.stringify(s)).not.toContain('tokenHash');
      expect(s.availability).toContain('computer');
    }
  });

  it('validates input', async () => {
    expect((await call('POST', '/api/shares', {})).statusCode).toBe(400);
    expect((await call('POST', '/api/shares', { path: 'relative/path.mp4' })).statusCode).toBe(400);
    expect((await call('POST', '/api/shares', { path: video + '\0' })).statusCode).toBe(400);
    expect((await call('POST', '/api/shares', { path: video, expiresInSeconds: -5 })).statusCode).toBe(400);
    expect((await call('POST', '/api/shares', { path: video, allowDownload: 'yes' })).statusCode).toBe(400);
    const missing = await call('POST', '/api/shares', { path: path.join(env.dir, 'nope.mp4') });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().message).toContain('does not exist');
  });

  it('applies expiry and revoke end to end', async () => {
    const r = (await call('POST', '/api/shares', { path: video, expiresInSeconds: 3600 })).json();
    expect(r.expiresAt).toBeGreaterThan(Date.now());
    expect((await fetch(r.url)).status).toBe(200);
    const rv = await call('POST', `/api/shares/${r.id}/revoke`);
    expect(rv.json().state).toBe('revoked');
    expect((await fetch(r.url)).status).toBe(410);
    expect((await call('POST', '/api/shares/doesnotexist/revoke')).statusCode).toBe(404);
  });

  it('verify refuses URLs outside the configured public address (no SSRF)', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data', 'https://example.com/s/abc', `${env.base}.evil.com/s/abc`]) {
      expect((await call('POST', '/api/verify', { url })).statusCode).toBe(400);
    }
  });

  it('shares a folder', async () => {
    const dir = path.join(env.dir, 'folder');
    writeRandom(path.join(dir, 'one.mp4'), 100);
    const r = (await call('POST', '/api/shares', { path: dir, verify: true })).json();
    expect(r.kind).toBe('folder');
    const html = await (await fetch(r.url)).text();
    expect(html).toContain('one.mp4');
  });
});

describe('configuration', () => {
  it('rejects invalid ports and URLs with clear messages', () => {
    expect(() => loadConfig({ IL_PUBLIC_PORT: 'abc' })).toThrow(/IL_PUBLIC_PORT/);
    expect(() => loadConfig({ IL_ADMIN_PORT: '99999' })).toThrow(/IL_ADMIN_PORT/);
    expect(() => loadConfig({ IL_PUBLIC_BASE_URL: 'not a url' })).toThrow(/not a valid URL/);
    expect(() => loadConfig({ IL_PUBLIC_BASE_URL: 'ftp://x.com' })).toThrow(/https/);
  });
  it('defaults to localhost-only binding', () => {
    const c = loadConfig({});
    expect(c.publicHost).toBe('127.0.0.1');
    expect(c.publicBaseUrl).toBe('http://localhost:8080');
  });
});
