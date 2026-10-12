# Testing (results from 2026-10-11, Linux x64, Node 22, Electron 44)

## Commands and what they proved
| Command | Result |
|---|---|
| `npm run typecheck` | passes (backend, UI, desktop) |
| `npm run lint` | passes (after fixing 1 real error + a config issue where generated files were linted) |
| `npm test` | 135 passed, 0 failed, 10 files (Linux) |
| `npm run build:desktop` | passes |
| `npm run dist` | produces `release/InstantLink-0.1.0.AppImage` (~126 MB) |
| `xvfb-run -a node e2e/desktop.e2e.mjs` | 11/11 checks pass on the source tree (the earlier 8 also passed on the packaged Linux app; the 3 newer stub-cloudflared checks have only been run on the source tree) |
| `npx tsx e2e/browser.e2e.ts` | Chromium: WebM plays+seeks (pass); 27.9 MB WebM: seeking sent a *new* Range request (`bytes=22249472-`) (pass); MP4/H.264 fails in this Chromium (it has no H.264 decoder; informational) |
| `xvfb-run -a node e2e/electron-codec.e2e.mjs` | H.264 MP4 plays and seeks in Electron's Chromium (pass) |
| AppImage `--appimage-extract-and-run` | started and stayed running until killed (smoke test only, no UI driven) |

## Covered by `npm test`
Range parsing · full/206/416/HEAD streaming, byte-identical download, unicode+space names, 5 simultaneous viewers, viewer abort mid-stream,
300 MB file streamed with ~46 MB RSS growth · path traversal (12 variants), symlinks, hidden files, token entropy/uniqueness/redaction, rate limiting
(incl. per-viewer key behind a tunnel, spoof resistance) · expiry, revoke, deleted/replaced file, view-only, XSS filename, restart persistence ·
link recovery (encrypt/decrypt, tamper, wrong key, revoked) · tunnel state machine with a fake tunnel program (start, URL parsing, failure, timeout, drop, stop) ·
admin API auth/validation/SSRF · config validation · regression test for the CLI revoke bug.

## Desktop e2e (real app, real window under a virtual display)
window renders · renderer has no Node access · link created through the UI · downloaded file byte-identical · Range 206 exact bytes ·
Copy Link puts the exact URL on the clipboard · Revoke in UI → 410 · starting the public connection without `cloudflared` shows a clear error.
The native file-picker dialog cannot be clicked automatically, so the test answers it from the main process with a chosen file.

## NOT tested (do not assume these work)
- **Any real public/external access** (tunnel could not start here: DNS for Cloudflare is blocked in this environment).
- Real Chrome, Safari, Firefox, mobile browsers (only Playwright's Chromium and Electron's Chromium).
- Windows and macOS (no builds, no tests). Folder selection through the UI (backend folder sharing is tested; the dialog flow is not). Drag-and-drop through the UI.
- Multi-GB real-disk files, slow/throttled networks, more than 5 viewers, source computer going offline mid-playback, app crash/restart through the UI (restart persistence is tested at the backend level).
- Permanent cloud hosting: not implemented, so not tested.

## Windows (added 2026-10-11)
- **Not run on a real Windows PC.** Verified instead: Windows rules unit-tested by passing `platform = 'win32'` (`test/windows.test.ts`: reserved names, `:` streams, drive-root and case-insensitive containment, home-folder guard, `Path` env spelling, `.cmd` ignored, rename retry);
  `npm ci --os=win32 --cpu=x64` from the lockfile resolves the Windows native packages (esbuild, rolldown, lightningcss) and none of the Linux ones.
- Real Electron app on Linux with a stub `cloudflared` placed next to the app: found, launched, address shown as "created", then "not answering" (never "verified"); Stop works.
- On Windows, `npm test` skips symlink tests and one illegal-filename test (visible as skipped, with reasons in the code). `npm run test:e2e` is Linux-only (needs xvfb).
- **Still unverified:** `npm install`/`npm run desktop` on Windows, real `cloudflared.exe` launch, Defender/SmartScreen behaviour, OneDrive placeholder files, the NSIS installer (`npm run dist:win`).

## Receiver website, Mode B (added 2026-10-12)
`test/web.test.ts` (7): policy forbids network requests, no external URLs or network APIs in the page, English/Hindi strings match.
`npx tsx e2e/receiver.e2e.ts` (9 checks, **real Chromium**): chosen video plays from a `blob:` URL and seeks; **0 requests sent after choosing the file**;
a `fetch()` from the page is blocked by the browser; second video replaces the first; unsupported video (`.mkv` with junk bytes) and non-video file show clear errors;
Hindi page + language switch; phone-size viewport (390 px, Chromium emulation, **not real Safari**): no sideways scroll, 48 px tap target, plays and seeks.
Limits: non-ASCII file *paths* could not be opened by the test tool in this sandbox (the page itself handled Unicode names, tested with in-memory files). Not tested: real iPhone/Android browsers, Firefox/Safari, large (multi-GB) local files, the deployed website (not deployed).
