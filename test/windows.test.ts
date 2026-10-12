import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHiddenName, isInside, isTooBroadFolder, isUnsafeWindowsName } from '../src/winsafe.js';
import { renameWithRetry } from '../src/fsutil.js';
import { findBinary } from '../src/tunnel.js';
import { esc, safeDisplayName } from '../src/html.js';
import { makeEnv, writeRandom, type Env } from './helpers.js';

// These run on any OS: Windows rules are exercised by passing platform = 'win32'.
describe('Windows file-name safety', () => {
  it.each(['clip.mp4:secret', 'a.mp4::$DATA', 'CON', 'nul.txt', 'COM1', 'lpt9.log', 'trailingdot.', 'trailingspace ', 'what?.mp4', 'a|b', 'a"b', 'a<b', 'x*y'])('flags %j as unsafe', (n) => {
    expect(isUnsafeWindowsName(n)).toBe(true);
  });
  it.each(['clip.mp4', 'My Video ñ 视频.mp4', 'console.mp4', 'com10.txt', 'a.b.c'])('allows %j', (n) => {
    expect(isUnsafeWindowsName(n)).toBe(false);
  });
  it('hides dotfiles everywhere and Windows system files only on Windows', () => {
    expect(isHiddenName('.env', 'linux')).toBe(true);
    expect(isHiddenName('desktop.ini', 'win32')).toBe(true);
    expect(isHiddenName('Thumbs.db', 'win32')).toBe(true);
    expect(isHiddenName('NTUSER.DAT.LOG1', 'win32')).toBe(true);
    expect(isHiddenName('$RECYCLE.BIN', 'win32')).toBe(true);
    expect(isHiddenName('video.mp4:stream', 'win32')).toBe(true);
    expect(isHiddenName('desktop.ini', 'linux')).toBe(false);
    expect(isHiddenName('video.mp4', 'win32')).toBe(false);
  });
});

describe('isInside (containment check)', () => {
  it('works for a normal folder', () => {
    expect(isInside('/a/b', '/a/b/c.mp4', 'linux')).toBe(true);
    expect(isInside('/a/b', '/a/b', 'linux')).toBe(true);
    expect(isInside('/a/b', '/a/bc/c.mp4', 'linux')).toBe(false);
    expect(isInside('/a/b', '/a/c', 'linux')).toBe(false);
  });
  it('is case-insensitive on Windows and handles a drive root (regression: C:\\ + sep)', () => {
    expect(isInside('C:\\Users\\Me\\Videos', 'c:\\users\\me\\videos\\clip.mp4', 'win32')).toBe(true);
    expect(isInside('C:\\', 'C:\\Windows\\x.dll', 'win32')).toBe(true);
    expect(isInside('C:\\Users\\Me', 'C:\\Users\\Meow\\x.mp4', 'win32')).toBe(false);
    expect(isInside('C:\\Users\\Me', 'D:\\Users\\Me\\x.mp4', 'win32')).toBe(false);
  });
});

describe('too-broad folder guard', () => {
  it('refuses drive roots, the user folder, and folders containing it (Windows)', () => {
    const home = 'C:\\Users\\Asha';
    for (const f of ['C:\\', 'D:\\', 'C:\\Users', home]) expect(isTooBroadFolder(f, home, 'win32'), f).toBe(true);
    for (const f of ['C:\\Users\\Asha\\Videos', 'D:\\Shared\\Clips', 'C:\\Users\\Other\\x']) expect(isTooBroadFolder(f, home, 'win32'), f).toBe(false);
    expect(isTooBroadFolder('c:\\users\\asha', home, 'win32')).toBe(true); // case-insensitive
  });
  it('same rules on Linux/macOS', () => {
    expect(isTooBroadFolder('/', '/home/asha', 'linux')).toBe(true);
    expect(isTooBroadFolder('/home', '/home/asha', 'linux')).toBe(true);
    expect(isTooBroadFolder('/home/asha', '/home/asha', 'linux')).toBe(true);
    expect(isTooBroadFolder('/home/asha/Videos', '/home/asha', 'linux')).toBe(false);
  });
});

describe('renameWithRetry (antivirus briefly locking the file)', () => {
  const err = (code: string) => Object.assign(new Error(code), { code });
  it('retries EPERM/EBUSY then succeeds', () => {
    let calls = 0;
    renameWithRetry('a', 'b', 8, 1, () => { if (++calls < 3) throw err(calls === 1 ? 'EPERM' : 'EBUSY'); });
    expect(calls).toBe(3);
  });
  it('gives up after the attempt limit and throws the real error', () => {
    let calls = 0;
    expect(() => renameWithRetry('a', 'b', 4, 1, () => { calls++; throw err('EPERM'); })).toThrow('EPERM');
    expect(calls).toBe(4);
  });
  it('does not retry unrelated errors', () => {
    let calls = 0;
    expect(() => renameWithRetry('a', 'b', 8, 1, () => { calls++; throw err('ENOENT'); })).toThrow('ENOENT');
    expect(calls).toBe(1);
  });
  it('really renames a file', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'il-rn-'));
    fs.writeFileSync(path.join(d, 'a'), 'x');
    renameWithRetry(path.join(d, 'a'), path.join(d, 'b'));
    expect(fs.readFileSync(path.join(d, 'b'), 'utf8')).toBe('x');
    fs.rmSync(d, { recursive: true });
  });
});

describe('findBinary on Windows rules', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'il-fb-'));
    fs.mkdirSync(path.join(dir, 'onpath'));
    fs.mkdirSync(path.join(dir, 'extra'));
    fs.mkdirSync(path.join(dir, 'cmdonly'));
    fs.mkdirSync(path.join(dir, 'pf', 'cloudflared'), { recursive: true });
    for (const f of ['onpath/cloudflared.exe', 'extra/cloudflared.exe', 'cmdonly/cloudflared.cmd', 'pf/cloudflared/cloudflared.exe']) {
      fs.writeFileSync(path.join(dir, f), '#!/bin/sh\n', { mode: 0o755 });
    }
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('finds cloudflared.exe on a PATH variable named "Path" (Windows spelling)', () => {
    expect(findBinary('cloudflared', { Path: path.join(dir, 'onpath') }, { platform: 'win32' })).toBe(path.join(dir, 'onpath', 'cloudflared.exe'));
  });
  it('accepts quoted PATH entries', () => {
    expect(findBinary('cloudflared', { Path: `"${path.join(dir, 'onpath')}"` }, { platform: 'win32' })).toBe(path.join(dir, 'onpath', 'cloudflared.exe'));
  });
  it('finds it in an extra folder (the folder next to the app)', () => {
    expect(findBinary('cloudflared', { Path: '' }, { platform: 'win32', extraDirs: [path.join(dir, 'extra')] })).toBe(path.join(dir, 'extra', 'cloudflared.exe'));
  });
  it('checks the usual Program Files location', () => {
    expect(findBinary('cloudflared', { Path: '', ProgramFiles: path.join(dir, 'pf') }, { platform: 'win32' })).toBe(path.join(dir, 'pf', 'cloudflared', 'cloudflared.exe'));
  });
  it('ignores .cmd wrappers (cannot be started without a shell)', () => {
    expect(findBinary('cloudflared', { Path: path.join(dir, 'cmdonly') }, { platform: 'win32' })).toBeNull();
  });
  it('returns null when absent', () => {
    expect(findBinary('cloudflared', { Path: path.join(dir, 'nothing-here') }, { platform: 'win32' })).toBeNull();
  });
});

describe('hostile file names are escaped without needing such a file on disk (works on Windows too)', () => {
  it('escapes HTML and strips separators/controls/bidi tricks', () => {
    expect(esc('"><img src=x onerror=alert(1)>')).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(safeDisplayName('a/b\\c\u202Ed.mp4')).toBe('a_b_cd.mp4');
  });
});

describe('admin refuses over-broad folders', () => {
  let env: Env;
  beforeAll(async () => { env = await makeEnv(); });
  afterAll(() => env.close());
  const post = (p: string) => env.admin.inject({ method: 'POST', url: '/api/shares', payload: { path: p }, headers: { host: 'localhost', 'x-admin-key': env.adminKey } });
  it('rejects the filesystem root and the home folder with a clear message', async () => {
    for (const p of [path.parse(os.homedir()).root, os.homedir()]) {
      const r = await post(p);
      expect(r.statusCode, p).toBe(400);
      expect(r.json().error).toBe('folder_too_broad');
      expect(r.json().message).toContain('too broad');
    }
  });
  it('still allows a specific folder', async () => {
    const dir = path.join(env.dir, 'clips');
    writeRandom(path.join(dir, 'a.mp4'), 100);
    expect((await post(dir)).statusCode).toBe(201);
  });
});
