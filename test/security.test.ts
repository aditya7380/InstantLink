import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addShare, makeEnv, rawGet, writeRandom, type Env } from './helpers.js';
import { redactUrl } from '../src/server.js';

let env: Env;
let folderToken: string;
let canSymlink = false;
const SECRET = 'TOP-SECRET-CONTENT';

beforeAll(async () => {
  env = await makeEnv();
  const shared = path.join(env.dir, 'shared');
  writeRandom(path.join(shared, 'a.mp4'), 5000);
  fs.mkdirSync(path.join(shared, 'sub dir'), { recursive: true });
  fs.writeFileSync(path.join(shared, 'sub dir', 'ünï.txt'), 'hello');
  fs.writeFileSync(path.join(shared, '.env'), SECRET);
  fs.writeFileSync(path.join(env.dir, 'outside.txt'), SECRET);
  fs.mkdirSync(path.join(env.dir, 'outside-dir'));
  fs.writeFileSync(path.join(env.dir, 'outside-dir', 'x.txt'), SECRET);
  try {
    fs.symlinkSync(path.join(env.dir, 'outside.txt'), path.join(shared, 'link-file.txt'));
    fs.symlinkSync(path.join(env.dir, 'outside-dir'), path.join(shared, 'link-dir'), 'junction');
    canSymlink = true;
  } catch { /* Windows without Developer Mode/admin cannot create symlinks: those tests are skipped, visibly */ }
  folderToken = addShare(env, shared).token;
});
afterAll(() => env.close());

const f = (rel: string) => `/s/${folderToken}/f/${rel}`;

describe('folder shares: legit access', () => {
  it('lists files and serves nested unicode/space paths', async () => {
    const page = await (await fetch(`${env.base}/s/${folderToken}`)).text();
    expect(page).toContain('a.mp4');
    expect(page).toContain('sub dir/ünï.txt');
    expect(page).not.toContain('.env');
    if (canSymlink) expect(page).not.toContain('link-file');
    const r = await fetch(`${env.base}${f(encodeURIComponent('sub dir') + '/' + encodeURIComponent('ünï.txt'))}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('hello');
  });
});

describe('path traversal and filesystem escape', () => {
  const attacks = [
    '../outside.txt',
    '..%2foutside.txt',
    '%2e%2e/outside.txt',
    '%2e%2e%2foutside.txt',
    '..%5coutside.txt',
    '....//outside.txt',
    '%252e%252e/outside.txt',
    'sub%20dir/../../outside.txt',
    '/etc/passwd',
    '%2fetc%2fpasswd',
    'a.mp4%00.txt',
    '..\\outside.txt',
  ];
  for (const a of attacks) {
    it(`blocks ${a}`, async () => {
      const r = await rawGet(env.base, f(a));
      expect(r.status).not.toBe(200);
      expect(r.status).not.toBe(206);
      expect(r.body.toString()).not.toContain(SECRET);
    });
  }
  it.skipIf(process.platform === 'win32')('blocks symlink to a file outside the shared root', async () => {
    if (!canSymlink) return;
    const r = await rawGet(env.base, f('link-file.txt'));
    expect(r.status).toBe(404);
    expect(r.body.toString()).not.toContain(SECRET);
  });
  it.skipIf(process.platform === 'win32')('blocks files reached through a symlinked directory', async () => {
    if (!canSymlink) return;
    const r = await rawGet(env.base, f('link-dir/x.txt'));
    expect(r.status).toBe(404);
    expect(r.body.toString()).not.toContain(SECRET);
  });
  it('refuses hidden files like .env even when guessed', async () => {
    const r = await rawGet(env.base, f('.env'));
    expect(r.status).toBe(404);
    expect(r.body.toString()).not.toContain(SECRET);
  });
  it('a file-share token cannot be used to read other paths', async () => {
    const t = addShare(env, path.join(env.dir, 'shared', 'a.mp4')).token;
    for (const p of [`/s/${t}/f/../outside.txt`, `/s/${t}/f/outside.txt`]) {
      const r = await rawGet(env.base, p);
      expect(r.status).toBe(404);
    }
  });
  it.skipIf(process.platform === 'win32')('detects a shared file swapped for a symlink to elsewhere', async () => {
    const victim = path.join(env.dir, 'swap.mp4');
    writeRandom(victim, 2000);
    const t = addShare(env, victim).token;
    fs.rmSync(victim);
    fs.symlinkSync(path.join(env.dir, 'outside.txt'), victim);
    const r = await rawGet(env.base, `/s/${t}/file`);
    expect(r.status).toBe(404);
    expect(r.body.toString()).not.toContain(SECRET);
  });
});

describe('tokens', () => {
  it('invalid / malformed tokens get a uniform 404', async () => {
    for (const t of ['nope', 'A'.repeat(43), '%00', 'x'.repeat(300)]) {
      const r = await rawGet(env.base, `/s/${t}/file`);
      expect([404, 400]).toContain(r.status);
      const p = await rawGet(env.base, `/s/${t}`);
      expect([404, 400]).toContain(p.status);
    }
  });
  it('the real token is never stored on disk, only its hash', () => {
    const disk = fs.readFileSync(path.join(env.dir, 'shares.json'), 'utf8');
    expect(disk).not.toContain(folderToken);
  });
  it('tokens are unique and long', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => addShare(env, path.join(env.dir, 'shared', 'a.mp4')).token));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(43);
  });
  it('redactUrl hides tokens in log lines', () => {
    expect(redactUrl('/s/abcDEF123/file?download=1')).toBe('/s/[redacted]/file?download=1');
  });
});

describe('unknown routes and rate limiting', () => {
  it('does not expose admin routes on the public server', async () => {
    for (const p of ['/api/shares', '/admin', '/shares.json', '/']) {
      const r = await rawGet(env.base, p);
      expect(r.status).toBe(404);
    }
  });
  it('rate limits abusive clients with 429', async () => {
    const e2 = await makeEnv({ rateLimitMax: 5 });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 10; i++) statuses.push((await rawGet(e2.base, '/s/guess/file')).status);
      expect(statuses).toContain(429);
    } finally {
      await e2.close();
    }
  });
});
