import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addShare, makeEnv, writeRandom, type Env } from './helpers.js';
import { ShareStore } from '../src/store.js';

let env: Env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(() => env.close());

describe('expiry and revocation', () => {
  it('rejects expired links with 410 (server-side)', async () => {
    const file = path.join(env.dir, 'e.mp4');
    writeRandom(file, 100);
    const { token } = addShare(env, file, { expiresAt: Date.now() - 1000 });
    const r = await fetch(`${env.base}/s/${token}/file`);
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({ error: 'expired' });
    const page = await fetch(`${env.base}/s/${token}`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain('expired');
  });

  it('a link stops working immediately after revoke', async () => {
    const file = path.join(env.dir, 'r.mp4');
    writeRandom(file, 100);
    const { token, share } = addShare(env, file);
    expect((await fetch(`${env.base}/s/${token}/file`)).status).toBe(200);
    env.store.revoke(share.id);
    const r = await fetch(`${env.base}/s/${token}/file`);
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({ error: 'revoked' });
  });

  it('expires while in use: a later request is refused', async () => {
    const file = path.join(env.dir, 'x.mp4');
    writeRandom(file, 100);
    const { token, share } = addShare(env, file);
    expect((await fetch(`${env.base}/s/${token}/file`)).status).toBe(200);
    env.store.setExpiry(share.id, Date.now() - 1);
    expect((await fetch(`${env.base}/s/${token}/file`)).status).toBe(410);
  });
});

describe('source problems', () => {
  it('reports a deleted file as unavailable, without leaking the path', async () => {
    const file = path.join(env.dir, 'gone.mp4');
    writeRandom(file, 100);
    const { token } = addShare(env, file);
    fs.rmSync(file);
    const r = await fetch(`${env.base}/s/${token}`);
    const html = await r.text();
    expect(r.status).toBe(404);
    expect(html).toContain('File unavailable');
    expect(html).not.toContain(env.dir);
  });

  it('refuses a file that was replaced after the link was created (no silent swap)', async () => {
    const file = path.join(env.dir, 'swap-content.mp4');
    writeRandom(file, 100);
    const { token } = addShare(env, file);
    await new Promise((r) => setTimeout(r, 20));
    writeRandom(file, 200);
    const r = await fetch(`${env.base}/s/${token}/file`);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'file_changed' });
  });

  it('can turn downloads off (view-only link)', async () => {
    const file = path.join(env.dir, 'v.mp4');
    writeRandom(file, 100);
    const { token } = addShare(env, file, { allowDownload: false });
    expect((await fetch(`${env.base}/s/${token}/file?download=1`)).status).toBe(403);
    expect((await fetch(`${env.base}/s/${token}/file`)).status).toBe(200);
    const page = await (await fetch(`${env.base}/s/${token}`)).text();
    expect(page).not.toContain('Download');
  });

  // Characters like " < > are illegal in Windows file names; the same escaping is unit-tested in windows.test.ts.
  it.skipIf(process.platform === 'win32')('escapes hostile filenames in the share page (no XSS)', async () => {
    const file = path.join(env.dir, '"><img src=x onerror=alert(1)>.mp4');
    writeRandom(file, 100);
    const { token } = addShare(env, file);
    const html = await (await fetch(`${env.base}/s/${token}`)).text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('restart recovery', () => {
  it('shares survive an app restart and revocation persists', async () => {
    const file = path.join(env.dir, 'persist.mp4');
    writeRandom(file, 100);
    const { token, share } = addShare(env, file);
    env.store.revoke(share.id);
    const reloaded = new ShareStore(path.join(env.dir, 'shares.json'));
    expect(reloaded.findByToken(token)?.revokedAt).not.toBeNull();
    expect(reloaded.list().length).toBe(env.store.list().length);
  });
});
