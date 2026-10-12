import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addShare, makeEnv, writeRandom, type Env } from './helpers.js';

let env: Env;
let data: Buffer;
let file: string;
let token: string;

beforeAll(async () => {
  env = await makeEnv();
  file = path.join(env.dir, 'media', 'my video ñ 视频.mp4');
  data = writeRandom(file, 1_000_000);
  token = addShare(env, file).token;
});
afterAll(() => env.close());

const url = (suffix = '/file') => `${env.base}/s/${token}${suffix}`;

describe('file streaming', () => {
  it('serves the whole file with correct headers', async () => {
    const r = await fetch(url());
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('content-length')).toBe(String(data.length));
    expect(Buffer.from(await r.arrayBuffer()).equals(data)).toBe(true);
  });

  it('returns 206 with exact bytes for a range (seeking)', async () => {
    const r = await fetch(url(), { headers: { Range: 'bytes=1000-1999' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 1000-1999/${data.length}`);
    expect(r.headers.get('content-length')).toBe('1000');
    expect(Buffer.from(await r.arrayBuffer()).equals(data.subarray(1000, 2000))).toBe(true);
  });

  it('supports open-ended and suffix ranges', async () => {
    const a = await fetch(url(), { headers: { Range: `bytes=${data.length - 10}-` } });
    expect(a.status).toBe(206);
    expect(Buffer.from(await a.arrayBuffer()).equals(data.subarray(-10))).toBe(true);
    const b = await fetch(url(), { headers: { Range: 'bytes=-5' } });
    expect(Buffer.from(await b.arrayBuffer()).equals(data.subarray(-5))).toBe(true);
  });

  it('returns 416 for unsatisfiable ranges', async () => {
    const r = await fetch(url(), { headers: { Range: `bytes=${data.length}-` } });
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe(`bytes */${data.length}`);
  });

  it('HEAD returns headers and no body', async () => {
    const r = await fetch(url(), { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe(String(data.length));
    expect((await r.arrayBuffer()).byteLength).toBe(0);
  });

  it('encodes unicode/space filenames safely in Content-Disposition', async () => {
    const r = await fetch(url('/file?download=1'));
    const cd = r.headers.get('content-disposition')!;
    expect(cd.startsWith('attachment;')).toBe(true);
    expect(cd).toContain("filename*=UTF-8''my%20video%20%C3%B1%20%E8%A7%86%E9%A2%91.mp4");
    await r.arrayBuffer();
  });

  it('sets privacy/security headers', async () => {
    const r = await fetch(url(), { method: 'HEAD' });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('share page shows name + player, never the real path', async () => {
    const r = await fetch(url(''));
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('<video');
    expect(html).toContain('my video ñ 视频.mp4');
    expect(html).not.toContain(env.dir);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('serves 5 simultaneous viewers with correct, different ranges', async () => {
    const ranges = [0, 200_000, 400_000, 600_000, 800_000];
    const results = await Promise.all(
      ranges.map(async (s) => {
        const r = await fetch(url(), { headers: { Range: `bytes=${s}-${s + 99_999}` } });
        return { s, status: r.status, body: Buffer.from(await r.arrayBuffer()) };
      }),
    );
    for (const x of results) {
      expect(x.status).toBe(206);
      expect(x.body.equals(data.subarray(x.s, x.s + 100_000))).toBe(true);
    }
  });

  it('survives a viewer disconnecting mid-stream', async () => {
    const big = path.join(env.dir, 'big-abort.mp4');
    fs.writeFileSync(big, Buffer.alloc(30_000_000));
    const t = addShare(env, big).token;
    const ctrl = new AbortController();
    const r = await fetch(`${env.base}/s/${t}/file`, { signal: ctrl.signal });
    const reader = r.body!.getReader();
    await reader.read();
    ctrl.abort();
    await reader.cancel().catch(() => undefined);
    const ok = await fetch(`${env.base}/healthz`);
    expect(ok.status).toBe(200);
    const again = await fetch(`${env.base}/s/${t}/file`, { headers: { Range: 'bytes=0-9' } });
    expect(again.status).toBe(206);
    await again.arrayBuffer();
  });

  it('streams a 300 MB file without buffering it in memory', async () => {
    const huge = path.join(env.dir, 'huge.mp4');
    const fd = fs.openSync(huge, 'w');
    fs.ftruncateSync(fd, 300 * 1024 * 1024); // sparse file, instant
    fs.closeSync(fd);
    const t = addShare(env, huge).token;
    global.gc?.();
    const before = process.memoryUsage().rss;
    let peak = before;
    const r = await fetch(`${env.base}/s/${t}/file`);
    expect(r.status).toBe(200);
    let total = 0;
    const reader = r.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      peak = Math.max(peak, process.memoryUsage().rss);
    }
    expect(total).toBe(300 * 1024 * 1024);
    const growthMb = (peak - before) / 1024 / 1024;
    console.log(`rss growth while streaming 300MB: ${growthMb.toFixed(1)} MB`);
    expect(growthMb).toBeLessThan(120);
    // seeking near the end of a huge file works
    const tail = await fetch(`${env.base}/s/${t}/file`, { headers: { Range: 'bytes=-100' } });
    expect(tail.headers.get('content-range')).toBe(`bytes ${300 * 1024 * 1024 - 100}-${300 * 1024 * 1024 - 1}/${300 * 1024 * 1024}`);
    await tail.arrayBuffer();
  });
});
