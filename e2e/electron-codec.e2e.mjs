// Does H.264 MP4 play+seek in Electron's Chromium? Run: npm run build:desktop && xvfb-run -a node e2e/electron-codec.e2e.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ShareStore } from '../dist-desktop/js/src/store.js';
import { buildPublicServer } from '../dist-desktop/js/src/server.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'il-codec-'));
const mp4 = path.join(tmp, 'clip.mp4');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=10:size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', mp4]);
const store = new ShareStore(null);
const st = fs.statSync(mp4);
const { token } = store.create({ kind: 'file', sourcePath: fs.realpathSync(mp4), displayName: 'clip.mp4', sizeAtCreate: st.size, mtimeMsAtCreate: st.mtimeMs, expiresAt: null, allowDownload: true });
const server = buildPublicServer(store, { rateLimitMax: 0 });
await server.listen({ host: '127.0.0.1', port: 0 });
const url = `http://localhost:${server.server.address().port}/s/${token}`;

const app = await electron.launch({ args: ['e2e/electron-main-stub.cjs', '--no-sandbox'], timeout: 60000 });
let ok;
try {
  const winPromise = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }, u) => { const w = new BrowserWindow({ show: false, webPreferences: { autoplayPolicy: 'no-user-gesture-required' } }); w.loadURL(u); }, url);
  const page = await winPromise;
  await page.waitForSelector('video');
  const r = await page.evaluate(`(async () => {
    const v = document.querySelector('video');
    const wait = (ev, ms = 8000) => new Promise((res) => { const t = setTimeout(() => res(false), ms); v.addEventListener(ev, () => { clearTimeout(t); res(true); }, { once: true }); });
    if (v.readyState < 1 && !v.error) await Promise.race([wait('loadedmetadata'), wait('error')]);
    if (v.error) return { ok: false, error: 'MediaError code ' + v.error.code };
    await v.play().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1200));
    const playedTo = v.currentTime;
    v.currentTime = v.duration * 0.8;
    const seeked = await wait('seeked');
    return { ok: !v.error && playedTo > 0.3 && seeked, duration: v.duration, playedTo, afterSeek: v.currentTime, seeked };
  })()`);
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  mp4 H.264+AAC in Electron Chromium:`, JSON.stringify(r));
  ok = r.ok;
} finally {
  await app.close();
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
