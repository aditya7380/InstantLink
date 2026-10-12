// Real-browser test of Receiver Local Video (Mode B). Run: npx tsx e2e/receiver.e2e.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium, devices } from 'playwright-core';
// @ts-expect-error plain ESM script without types
import { startWebServer } from '../scripts/serve-web.mjs';

const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'il-recv-'));
const webm = path.join(tmp, 'clip.webm');
const webm2 = path.join(tmp, 'second.webm');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=10:size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', webm]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=4:size=160x120:rate=25', '-c:v', 'libvpx', '-b:v', '100k', '-an', webm2]);
const bogus = path.join(tmp, 'broken.mkv');
fs.writeFileSync(bogus, Buffer.alloc(5000, 7));
const notes = path.join(tmp, 'notes.txt');
fs.writeFileSync(notes, 'hello');

const { server, hits, port } = await startWebServer(0);
const base = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const results: string[] = [];
const pass = (s: string) => { results.push(s); console.log('PASS', s); };

// Poll from Node: page.waitForFunction evaluates inside the page with eval, which the page's CSP (correctly) forbids.
async function until(page: import('playwright-core').Page, check: () => boolean, timeoutMs = 10_000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(check)) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for: ${check.toString().slice(0, 120)}`);
    await page.waitForTimeout(100);
  }
}

// NOTE: the page's CSP forbids eval, so Playwright must be given real functions (not strings).
// Keep these inline and anonymous: tsx would inject helper calls that do not exist inside the page.
async function playAndSeek(page: import('playwright-core').Page) {
  await until(page, () => (document.getElementById('video') as HTMLVideoElement).readyState >= 1);
  await page.evaluate(() => (document.getElementById('video') as HTMLVideoElement).play());
  await page.waitForTimeout(1200);
  const played = await page.evaluate(() => { const v = document.getElementById('video') as HTMLVideoElement; return { t: v.currentTime, d: v.duration }; });
  assert.ok(played.t > 0.3, `did not advance: ${played.t}`);
  await page.evaluate(() => { const v = document.getElementById('video') as HTMLVideoElement; v.currentTime = v.duration * 0.8; });
  await until(page, () => { const v = document.getElementById('video') as HTMLVideoElement; return v.currentTime >= v.duration * 0.78; }, 8000);
  return played;
}

try {
  // ---- Desktop: choose, play, seek, and prove nothing is sent
  const page = await browser.newPage();
  const requests: { method: string; url: string }[] = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('#file', { state: 'attached' });
  const hitsBefore = hits.length;
  const reqBefore = requests.length;
  // Unicode name passed as an in-memory file: Playwright cannot open non-ASCII *disk paths* in this sandbox (locale), which is a test-tool limit, not a page limit.
  await page.setInputFiles('#file', { name: 'My clip ñ 视频.webm', mimeType: 'video/webm', buffer: fs.readFileSync(webm) });
  const played = await playAndSeek(page);
  const src = await page.evaluate(() => (document.getElementById('video') as HTMLVideoElement).currentSrc.slice(0, 5));
  assert.equal(src, 'blob:');
  pass(`desktop: chosen video plays from a blob: URL (advanced to ${played.t.toFixed(1)}s) and seeking to 80% works`);
  const meta = await page.textContent('#meta');
  assert.match(meta ?? '', /My clip ñ 视频\.webm/);
  assert.match(meta ?? '', /320×240/);
  pass(`desktop: file name, size, duration and resolution shown ("${meta?.trim()}")`);

  assert.equal(hits.length, hitsBefore, 'server received requests after the file was chosen');
  const newReqs = requests.slice(reqBefore).filter((r) => !r.url.startsWith('blob:'));
  assert.deepEqual(newReqs, []);
  assert.ok(requests.every((r) => r.method === 'GET'), 'a non-GET request was made');
  pass('no upload: after choosing the video the page sent 0 requests to any server (only the local blob: URL was read)');

  const blocked = await page.evaluate(() => fetch(location.origin + '/leak').then(() => 'SENT', () => 'BLOCKED'));
  assert.equal(blocked, 'BLOCKED');
  assert.ok(!hits.some((h) => h.includes('/leak')), 'blocked fetch still reached the server');
  pass('browser enforces the policy: a fetch() from the page is blocked before it leaves the browser');

  // replacing the video
  await page.setInputFiles('#file', webm2);
  await until(page, () => (document.getElementById('video') as HTMLVideoElement).videoWidth === 160);
  pass('choosing a second video replaces the first');

  // unsupported / broken video
  await page.setInputFiles('#file', bogus);
  await page.waitForSelector('#error:not([hidden])', { timeout: 10_000 });
  const err1 = await page.textContent('#error');
  assert.match(err1 ?? '', /cannot play this video format \(broken\.mkv\)/);
  pass(`unsupported video shows a clear error: "${err1?.trim()}"`);

  await page.setInputFiles('#file', notes);
  await page.waitForSelector('#error:not([hidden])');
  assert.match((await page.textContent('#error')) ?? '', /does not look like a video/);
  assert.equal(await page.isHidden('#player'), true);
  pass('a non-video file is rejected with a clear message');

  // Hindi
  await page.goto(`${base}/?lang=hi`);
  assert.match((await page.textContent('h2')) ?? '', /अपने डिवाइस का वीडियो देखें/);
  await page.click('#lang');
  assert.match((await page.textContent('h2')) ?? '', /Watch a video from your device/);
  pass('Hindi page loads via ?lang=hi and the language button switches to English');
  assert.deepEqual(consoleErrors.filter((e) => !/Failed to load resource|MEDIA_ELEMENT_ERROR|CSP|Content Security Policy/i.test(e)), []);
  await page.close();

  // ---- Phone-sized screen (Chromium emulating an iPhone 13 viewport; NOT real Safari)
  const ctx = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined } as never);
  const m = await ctx.newPage();
  await m.goto(base);
  const layout = await m.evaluate(() => { const r = (document.querySelector('label.btn') as HTMLElement).getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, btn: { w: r.width, h: r.height } }; });
  assert.ok(layout.sw <= layout.iw, `horizontal scroll on phone: ${layout.sw} > ${layout.iw}`);
  assert.ok(layout.btn.h >= 44 && layout.btn.w >= 44, 'tap target too small');
  await m.setInputFiles('#file', webm);
  await playAndSeek(m);
  pass(`phone viewport (${layout.iw}px wide): no sideways scrolling, tap target ${Math.round(layout.btn.w)}×${Math.round(layout.btn.h)}px, plays and seeks`);
  await ctx.close();

  console.log(`\nALL ${results.length} RECEIVER E2E CHECKS PASSED`);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
