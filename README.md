# InstantLink

Turn a file or folder that is already on your computer into a share link **without uploading it anywhere**.
The recipient opens the link in an ordinary browser; the file streams from your computer.

> **Two modes.** *Sender share* (desktop app): link to a video on your computer, instantly, nothing uploaded; works while your computer is on.
> *Receiver local video* (website in `web/`): a person picks a video on their own device and plays it there; it is never uploaded.
> **A link cannot work when the sender's device is off unless the video is uploaded:** see `OFFLINE_OPTIONS.md`. Deployment and GitHub: `DEPLOYMENT.md`.

> **Status: working MVP, not a finished product.** The desktop app, link creation, streaming/seeking, expiry and revoke
> are built and tested. **Internet access through a Cloudflare tunnel is built but has NOT been verified from another
> network** (see `PUBLIC_ACCESS.md`). Permanent cloud hosting and password-protected links are **not implemented**.

## For a beginner: how to use the desktop app
1. Install the app (Linux AppImage in `release/`, see "Install" below). Windows/macOS installers are not built yet.
2. Click **Select File** (or **Select Folder**, or drag a file in).
3. Choose when the link should stop working, then click **Create Link**.
4. Click **Copy Link** and paste it into your form, email or message.
5. To let people on *other networks* open it, click **Start public connection** (needs the free `cloudflared` program, see `PUBLIC_ACCESS.md`).
6. **Revoke Link** turns a link off immediately.

Three things to understand:
- The link works **only while your computer is on, online, and InstantLink is open**. This is *local sharing*; nothing is uploaded.
- Anyone who has the link can open it. A long random link is hard to guess, but it is **not a password**.
- Every viewer downloads the video through *your* internet upload speed.

## Install / run
**Windows users: follow `WINDOWS.md`** (the Linux AppImage does not run on Windows). Requires Node.js **22.12 or newer**.
```bash
npm install
npm run desktop          # build and open the desktop app from source
npm run dist             # build the Linux AppImage into release/
```
Run the AppImage: `chmod +x InstantLink-0.1.0.AppImage && ./InstantLink-0.1.0.AppImage`
(on some systems add `--no-sandbox`; see `TROUBLESHOOTING` below).

Command-line mode (no window, for developers): `npm start -- "/full/path/video.mp4"`, then `npm run cli -- list | revoke <id>`.

## Development
| Command | What it does |
|---|---|
| `npm run web` | preview the receiver website at http://localhost:8090 |
| `npm test` | 135 unit/integration tests (real HTTP servers, temp files; Windows rules simulated) |
| `npm run typecheck` | strict TypeScript for backend, desktop and UI |
| `npm run lint` | ESLint |
| `npm run test:e2e` | launches the real desktop app + real browsers (needs `xvfb`, `ffmpeg`, Chromium) |
| `npm run build:desktop` | build UI + app code into `dist-desktop/` |

## What it does today
- Link creation in milliseconds, file never read or copied (2 GB file: ~8 ms measured).
- HTTP Range requests (seeking), HEAD, 206/416, correct Content-Length/Disposition.
- Expiry (1 h / 24 h / 7 d / 30 d / never, changeable later), instant revoke, view-only links, folder sharing.
- **Copy a link again later**: the token is stored encrypted (AES-256-GCM) with a local key; the public server only knows its hash.
- Recipient page: video/audio player, download button (if allowed), clear expired / revoked / unavailable / invalid states, no local paths shown.
- Honest status in the app: "link created", "file readable", "reachable by other people: NOT yet", "playback: not tested".

## Not done (see `PRODUCT_ROADMAP.md`)
Password links · permanent cloud hosting (Mode B/C) · tested Windows & macOS builds (Windows source run is documented in `WINDOWS.md` but untested on a real PC) · code signing / auto-update ·
external verification of the public tunnel · load testing beyond 5 viewers · multi-GB real-disk test.

## Troubleshooting
- **Link opens only on my computer:** you have not started the public connection, or it failed (the app shows why).
- **"cloudflared is not installed":** install it (`PUBLIC_ACCESS.md`) and restart InstantLink.
- **Public address changed / old link dead:** free "quick tunnel" addresses change every time. Press **Copy Link** again; the app builds it with the current address.
- **Port busy:** the app automatically picks another port.
- **AppImage will not start (Linux):** run with `--no-sandbox`, or `--appimage-extract-and-run` if FUSE is missing.
- **Video does not play for the recipient:** their browser may not support the format. H.264 MP4 and WebM are the safest; offer **Download** as a fallback.
