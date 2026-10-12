import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cli = path.join(root, 'src', 'cli.ts');
const STUB_URL = 'https://cli-stub-test.trycloudflare.com';

// A shell-script stand-in for cloudflared (the real one cannot reach Cloudflare from the test machine).
const STUB = `#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\necho "INF |  ${STUB_URL}  |"\nsleep 300\n`;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

describe.skipIf(process.platform === 'win32')('real CLI processes: serve --public in one process, share in another', () => {
  let tmp: string;
  let env: NodeJS.ProcessEnv;
  let server: ChildProcess | null = null;
  let out = '';
  let pubPort: number;
  let admPort: number;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'il-cli-')));
    pubPort = await freePort();
    admPort = await freePort();
    env = { ...process.env, IL_DATA_DIR: path.join(tmp, 'data'), IL_PUBLIC_PORT: String(pubPort), IL_ADMIN_PORT: String(admPort) };
    delete env.IL_CLOUDFLARED_PATH;
    delete env.IL_PUBLIC_HOST;
    out = '';
  });
  afterEach(async () => {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((r) => { server!.once('exit', r); setTimeout(r, 3000); });
    }
    server = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function start(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}, waitFor: RegExp = /Public address: |Public connection FAILED/): Promise<void> {
    server = spawn(process.execPath, [tsx, cli, 'serve', ...args], { cwd, env: { ...env, ...extraEnv } });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server output never matched ${waitFor}: ${out}`)), 30_000);
      const onData = (b: Buffer) => { out += b.toString(); if (waitFor.test(out)) { clearTimeout(t); resolve(); } };
      server!.stdout!.on('data', onData);
      server!.stderr!.on('data', onData);
    });
  }
  const cliCmd = (args: string[], cwd = tmp) => run(process.execPath, [tsx, cli, ...args], { cwd, env });

  function makeStub(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'cloudflared');
    fs.writeFileSync(f, STUB, { mode: 0o755 });
    return f;
  }
  function makeVideo(): { file: string; data: Buffer } {
    const file = path.join(tmp, 'My Holiday Video ñ.mp4');
    const data = Buffer.alloc(300_000, 3);
    fs.writeFileSync(file, data);
    return { file, data };
  }

  it('finds cloudflared in the folder you run the command from, and a separate `share` process gets the PUBLIC link', async () => {
    const work = path.join(tmp, 'work dir');
    makeStub(work);
    const { file, data } = makeVideo();
    await start(['--public'], work);
    expect(out).toContain(`Public address: ${STUB_URL}`);

    // a different process, started from a different folder, like a second PowerShell window
    const shared = await cliCmd(['share', file, '--expires-hours', '2'], os.tmpdir());
    const link = /Link:\s+(\S+)/.exec(shared.stdout)?.[1] ?? '';
    expect(link.startsWith(`${STUB_URL}/s/`)).toBe(true);
    expect(shared.stdout).not.toContain('only works on THIS computer');
    expect(shared.stdout).toMatch(/Expires:/);
    expect(shared.stdout).not.toContain('Expires: never');

    // `link <id>` returns the same public link later
    const id = /id ([0-9a-f]{16})/.exec(shared.stdout)?.[1] ?? '';
    expect((await cliCmd(['link', id])).stdout.trim()).toBe(link);

    // the link's token really serves the exact file (the fake host is replaced by the local server)
    const token = link.split('/s/')[1]!;
    const res = await fetch(`http://127.0.0.1:${pubPort}/s/${token}/file`, { headers: { Range: 'bytes=0-99' } });
    expect(res.status).toBe(206);
    expect(Buffer.from(await res.arrayBuffer()).equals(data.subarray(0, 100))).toBe(true);
    const dl = await fetch(`http://127.0.0.1:${pubPort}/s/${token}/file?download=1`);
    expect(dl.headers.get('content-disposition')).toContain("filename*=UTF-8''My%20Holiday%20Video%20%C3%B1.mp4");
    expect((await dl.arrayBuffer()).byteLength).toBe(300_000);

    // the tunnel is pointed at the PUBLIC port only, never the admin port
    const args = fs.readFileSync(path.join(work, 'args.txt'), 'utf8').trim();
    expect(args).toContain(`--url http://127.0.0.1:${pubPort}`);
    expect(args).not.toContain(String(admPort));

    // revoke through the CLI
    await cliCmd(['revoke', id]);
    expect((await fetch(`http://127.0.0.1:${pubPort}/s/${token}/file`)).status).toBe(410);
  });

  it('honours IL_CLOUDFLARED_PATH even when the folder name contains a space (like "Aditya Verma")', async () => {
    const stub = makeStub(path.join(tmp, 'Aditya Verma', 'Downloads'));
    await start(['--public'], tmp, { IL_CLOUDFLARED_PATH: stub });
    expect(out).toContain(`Public address: ${STUB_URL}`);
  });

  it('a program only sitting in an unrelated folder (e.g. Downloads) is NOT found, with a clear message and local-only links', async () => {
    makeStub(path.join(tmp, 'Downloads'));
    const { file } = makeVideo();
    await start(['--public'], tmp);
    expect(out).toContain('Public connection FAILED');
    expect(out).toContain('IL_CLOUDFLARED_PATH');
    const shared = await cliCmd(['share', file]);
    expect(shared.stdout).toMatch(/Link:\s+http:\/\/localhost:/);
    expect(shared.stdout).toContain('only works on THIS computer');
  });

  it('warns when the public server is exposed to the whole network', async () => {
    await start([], tmp, { IL_PUBLIC_HOST: '0.0.0.0' }, /WARNING: IL_PUBLIC_HOST/);
    expect(out).toContain('does NOT need this');
  });

  it('shares a path that contains spaces only when it is quoted (unquoted words are separate arguments)', async () => {
    const { file } = makeVideo();
    await start([], tmp, {}, /InstantLink running/);
    const ok = await cliCmd(['share', file]);
    expect(ok.stdout).toContain('My Holiday Video ñ.mp4');
    // PowerShell without quotes would pass "...\My" as the path:
    await expect(cliCmd(['share', file.split(' ')[0]!])).rejects.toThrow(/not_found|does not exist/);
  });
});
