// Real end-to-end test of the packaged-style desktop app. Run: xvfb-run -a node e2e/desktop.e2e.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'il-e2e-'));
const media = path.join(tmp, 'My Clip ñ.mp4');
const data = randomBytes(400_000);
fs.writeFileSync(media, data);
const steps = [];
const pass = (s) => { steps.push(s); console.log('PASS', s); };

// IL_PACKAGED=/path/to/instantlink tests the built app instead of the source tree.
const packaged = process.env.IL_PACKAGED;
const app = await electron.launch({
  ...(packaged ? { executablePath: packaged } : {}),
  args: [...(packaged ? [] : ['.']), '--no-sandbox', `--user-data-dir=${path.join(tmp, 'ud')}`],
  env: { ...process.env },
  timeout: 60_000,
});
try {
  const win = await app.firstWindow();
  await win.waitForSelector('text=Select File');
  pass('window opened and UI rendered');

  // Security posture of the renderer
  const posture = await win.evaluate(() => ({ hasRequire: typeof require, hasProcess: typeof process, il: Object.keys(window.il ?? {}) }));
  assert.equal(posture.hasRequire, 'undefined');
  assert.equal(posture.hasProcess, 'undefined');
  assert.ok(posture.il.includes('createShare'));
  pass('renderer has no Node access; only the il bridge is exposed');

  // The native file dialog cannot be clicked in CI, so the main process answers it with our file.
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, media);
  await win.click('button:has-text("Select File")');
  await win.waitForSelector('text=My Clip');
  await win.click('button:has-text("Create Link")');
  const linkEl = await win.waitForSelector('[data-testid="created-link"]', { timeout: 20_000 });
  const url = (await linkEl.textContent()).trim();
  assert.match(url, /^http:\/\/localhost:\d+\/s\/[A-Za-z0-9_-]{43}$/);
  pass(`link created in UI: ${url.replace(/\/s\/.*/, '/s/[token]')}`);

  const full = await fetch(`${url}/file`);
  assert.equal(full.status, 200);
  assert.ok(Buffer.from(await full.arrayBuffer()).equals(data));
  pass('downloaded file is byte-identical to the original');
  const part = await fetch(`${url}/file`, { headers: { Range: 'bytes=1000-1999' } });
  assert.equal(part.status, 206);
  assert.ok(Buffer.from(await part.arrayBuffer()).equals(data.subarray(1000, 2000)));
  pass('Range request returns exact bytes (206)');

  await win.click('button:has-text("Copy Link")');
  await win.waitForSelector('text=Link copied');
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(clip, url);
  pass('Copy Link put the exact link on the clipboard');

  const shot = path.join(tmp, 'app.png');
  await win.screenshot({ path: shot });
  fs.copyFileSync(shot, path.join(process.cwd(), 'e2e', 'desktop-screenshot.png'));

  await win.click('button[aria-label^="Revoke link"]');
  await win.waitForSelector('text=Link turned off');
  const gone = await fetch(`${url}/file`);
  assert.equal(gone.status, 410);
  pass('Revoke Link in UI -> link returns 410 immediately');

  await win.click('button:has-text("Start public connection")');
  await win.waitForSelector('[role="alert"]', { timeout: 40_000 });
  const alertText = await win.textContent('[role="alert"]');
  console.log('INFO public connection result (cloudflared not installed here):', alertText?.slice(0, 160));
  pass('public connection failure is shown as a clear error, not a fake success');
  // Folder-based discovery (the beginner way on Windows): a stub "cloudflared" next to the app must be found and launched.
  const stubDir = packaged ? path.dirname(packaged) : process.cwd();
  const stub = path.join(stubDir, 'cloudflared');
  fs.writeFileSync(stub, '#!/bin/sh\necho "INF |  https://stub-test-abc.trycloudflare.com  |"\nsleep 120\n', { mode: 0o755 });
  try {
    await win.click('button:has-text("Start public connection")');
    await win.waitForSelector('.pill:has-text("Public address created")', { timeout: 30_000 });
    pass('cloudflared found in the app folder and launched; public address shown as "created"');
    await win.waitForSelector('.pill:has-text("not answering")', { timeout: 90_000 });
    const pill = await win.textContent('.pill');
    assert.ok(!/answered/.test(pill ?? ''), 'must not claim the address answered');
    pass('unreachable (fake) public address is reported as "not answering", never as verified');
    await win.click('button:has-text("Stop")');
    await win.waitForSelector('.pill:has-text("this computer only")');
    pass('Stop returns to local-only status');
  } finally {
    fs.rmSync(stub, { force: true });
  }
  console.log(`\nALL ${steps.length} DESKTOP E2E CHECKS PASSED`);
} finally {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
