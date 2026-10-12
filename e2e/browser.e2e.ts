// Real-browser test: does the share page actually PLAY and SEEK? Run: npx tsx e2e/browser.e2e.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { ShareStore } from '../src/store.js';
import { buildPublicServer } from '../src/server.js';

const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'il-browser-'));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
const src = ['-f', 'lavfi', '-i', 'testsrc=duration=10:size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10'];
const files: Record<string, string> = {
  'webm (VP8+Opus)': path.join(tmp, 'clip.webm'),
  'webm LARGE (forces real network seek)': path.join(tmp, 'large.webm'),
  'mp4 (H.264+AAC)': path.join(tmp, 'clip.mp4'),
};
// Playwright's open-source Chromium has no H.264 decoder, so MP4 is informational here (see e2e/electron-codec.e2e.mjs).
const informationalOnly = new Set(['mp4 (H.264+AAC)']);
const mustSeekOverNetwork = new Set(['webm LARGE (forces real network seek)']);
ff([...src, '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', files['webm (VP8+Opus)']!]);
ff(['-f', 'lavfi', '-i', 'testsrc2=duration=90:size=640x360:rate=25', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '12M', '-minrate', '12M', '-maxrate', '12M', '-an', files['webm LARGE (forces real network seek)']!]);
ff([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', files['mp4 (H.264+AAC)']!]);

const store = new ShareStore(null);
const rangeLog: string[] = [];
const server = buildPublicServer(store, { rateLimitMax: 0 });
server.addHook('onResponse', async (req, reply) => {
  if (req.url.includes('/file')) rangeLog.push(`${reply.statusCode} ${req.headers.range ?? '(no range)'}`);
});
await server.listen({ host: '127.0.0.1', port: 0 });
const base = `http://localhost:${(server.server.address() as { port: number }).port}`;

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
for (const [label, file] of Object.entries(files)) {
  const st = fs.statSync(file);
  const { token } = store.create({ kind: 'file', sourcePath: fs.realpathSync(file), displayName: path.basename(file), sizeAtCreate: st.size, mtimeMsAtCreate: st.mtimeMs, expiresAt: null, allowDownload: true });
  rangeLog.length = 0;
  const page = await browser.newPage();
  await page.goto(`${base}/s/${token}`);
  // Passed as a string: tsx/esbuild helpers (__name) do not exist inside the browser page.
  const result = (await page.evaluate(`(async () => {
    const v = document.querySelector('video');
    const wait = (ev, ms = 8000) => new Promise((res) => { const t = setTimeout(() => res(false), ms); v.addEventListener(ev, () => { clearTimeout(t); res(true); }, { once: true }); });
    if (v.readyState < 1 && !v.error) await Promise.race([wait('loadedmetadata'), wait('error')]);
    if (v.error) return { ok: false, stage: 'load', error: 'MediaError code ' + v.error.code };
    const duration = v.duration;
    await v.play().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1200));
    const playedTo = v.currentTime;
    v.currentTime = duration * 0.8;
    const seeked = await wait('seeked');
    await new Promise((r) => setTimeout(r, 800));
    return { ok: !v.error && playedTo > 0.3 && seeked && v.currentTime >= duration * 0.78, duration, playedTo, afterSeek: v.currentTime, seeked, error: v.error ? 'code ' + v.error.code : null };
  })()`)) as { ok: boolean };
  const seekRanges = rangeLog.filter((l) => /bytes=([1-9]\d*)-/.test(l));
  const networkSeekOk = !mustSeekOverNetwork.has(label) || seekRanges.length > 0;
  const status = informationalOnly.has(label) ? (result.ok ? 'PASS' : 'INFO(not counted)') : result.ok && networkSeekOk ? 'PASS' : 'FAIL';
  console.log(`${status}  ${label} (${(st.size / 1e6).toFixed(1)} MB):`, JSON.stringify(result));
  console.log(`      server saw ${rangeLog.length} request(s): ${rangeLog.slice(0, 6).join(' | ')}`);
  if (mustSeekOverNetwork.has(label)) console.log(`      seek caused a new Range request starting past byte 0: ${networkSeekOk}`);
  if (status === 'FAIL') failures++;
  await page.close();
}
await browser.close();
await server.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
