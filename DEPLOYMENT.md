# Running, deploying and pushing to GitHub

## Windows commands (PowerShell or Command Prompt)
Use `npm.cmd` in PowerShell: plain `npm` is often blocked there with "running scripts is disabled".
```powershell
cd C:\InstantLink\instantlink
npm.cmd install              # first time only
npm.cmd run typecheck        # strict TypeScript
npm.cmd run lint
npm.cmd test                 # 135 tests; a few that need symlinks are skipped on Windows and say so
npm.cmd run web              # website preview at http://localhost:8090
npm.cmd run desktop          # the desktop app
```
`npm.cmd run build:desktop` builds without opening it. `npm run test:e2e` is Linux-only (needs xvfb).

## What needs hosting? (smallest architecture)
| Part | Where it runs | Hosting needed? |
|---|---|---|
| **Receiver page** (play a video from your own device) | static files in `web/` | **Yes: any static host.** No server, no database, no secrets. |
| **Sender share** (link to a video on your PC) | the desktop app + a tunnel | No website needed. The link points at the tunnel. |
| Persistent storage (future) | cloud storage + small server | see `OFFLINE_OPTIONS.md` |

The desktop (Electron) app does **not** need a separate web frontend. The website is separate and tiny.

## Deploy the website (not done yet; I have no account access)
The folder to publish is **`web`** (contains `index.html`, `app.js`, `styles.css`, `favicon.svg`, `_headers`).
Recommended: **Cloudflare Pages**, because it applies the `_headers` file (security headers). Menu names change; the idea is:
1. Push the project to GitHub (below). 2. In the Cloudflare dashboard open *Workers & Pages → Create → Pages → Connect to Git*, pick the repo.
3. Framework preset: **None**. Build command: **leave empty**. Build output directory: **`web`**. Deploy.
   (Or choose direct upload and drag in the `web` folder.)
4. Verify (see below). Alternatives: Netlify (also reads `_headers`), GitHub Pages (ignores `_headers`; the page still carries its policy in a `<meta>` tag).
Free plans exist at these providers; **I did not verify current limits or prices.**

**Verify after deploying (you):** open the URL on your phone, choose a video, play and seek it. In PowerShell:
`curl.exe -I https://YOUR-SITE/` and confirm a `content-security-policy` line containing `connect-src 'none'`. Only then call it deployed.

## GitHub: first push
Install Git for Windows (git-scm.com) if `git --version` fails. Create an **empty private repository** on github.com (no README, no .gitignore).
```powershell
cd C:\InstantLink\instantlink
git init
git add -A
git status                   # STOP and check: cloudflared.exe, .env, secret.key, node_modules must NOT be listed
git commit -m "InstantLink first version"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/instantlink.git
git push -u origin main      # a browser window may ask you to sign in to GitHub
```
`.gitignore` already excludes secrets, `cloudflared.exe`, build output and local data. This was checked in a scratch copy (66 files would be committed; the exe, `.env` and `secret.key` were ignored; no keys or personal paths found). Never paste secret keys into chat or files in the repo; future cloud keys go in a local `.env` (see `.env.example`).

## Environment variables (all optional today)
See `.env.example`: `IL_DATA_DIR`, `IL_PUBLIC_HOST`, `IL_PUBLIC_PORT`, `IL_ADMIN_PORT`, `IL_PUBLIC_BASE_URL` (CLI mode), `IL_CLOUDFLARED_PATH` (full path to `cloudflared.exe`), `PORT` (website preview port).
