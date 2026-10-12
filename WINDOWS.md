# InstantLink on Windows: beginner guide

**Honest status.** Windows could **not** be tested by me (my environment is Linux). What I did: read the code for Windows problems, fixed the ones I found,
simulated Windows rules in automated tests, and simulated a Windows `npm install` from the lockfile (the Windows native packages resolve).
**Nobody has run this app on a real Windows PC yet. You will be the first, so report exactly what you see.**
The Linux AppImage does **not** work on Windows. You run the app from the source folder with `npm run desktop`.

## Part A: Run the app (about 15 minutes)
1. **Install Node.js 22 LTS.** Go to https://nodejs.org, download the **Windows Installer (.msi), 64-bit**, version **22.x (LTS)**. The app needs **22.12 or newer**.
   Click Next with the defaults. **Leave the optional "tools for native modules" checkbox unticked.**
2. **Check it:** press the Windows key, type `cmd`, press Enter (Command Prompt). Type `node -v` and press Enter. You should see `v22.` followed by numbers.
   Type `npm -v`. You should see a number. (If `node` is not recognized, close and reopen Command Prompt, or restart Windows.)
3. **Unzip** `instantlink-source.zip` (right-click → Extract All) to a short path such as `C:\InstantLink`. Avoid OneDrive and "Downloads".
   Open the inner folder that contains the file `package.json`.
4. **Open Command Prompt in that folder:** click the address bar at the top of the Explorer window, type `cmd`, press Enter.
   *Use Command Prompt, not PowerShell: PowerShell often blocks `npm` with a "running scripts is disabled" error.*
5. Type `npm install` and press Enter. It downloads about 300 MB (including Electron) and takes a few minutes. Yellow `warn` lines are normal.
   A message about "8 moderate vulnerabilities" refers to build tools that are not shipped in the app; ignore it.
6. Type `npm run desktop` and press Enter. The first start builds the app (about 30-60 seconds), then the InstantLink window opens.
   If Windows asks to allow network access, you can click Cancel: the app only listens on your own computer.

**If anything fails, copy the last 20 lines from the black window and send them to me.**

## Part B: Get `cloudflared` (the free tool that creates the public address)
1. Open https://github.com/cloudflare/cloudflared/releases/latest and under **Assets** download **`cloudflared-windows-amd64.exe`**.
2. Rename it to **`cloudflared.exe`** and move it into the **same folder as `package.json`**.
3. **Check it runs:** in the same Command Prompt, type `cloudflared.exe --version`. It should print a version. If Windows Defender/SmartScreen blocks or deletes it,
   tell me exactly what it says (the file is Cloudflare's official release, but I cannot verify your PC's antivirus).
   **Command line (`npm.cmd run cli -- serve --public`):** it looks for `cloudflared.exe` in this order: `IL_CLOUDFLARED_PATH`, your PATH, the folder you run the command from, the project folder, then `%USERPROFILE%\.instantlink`. If yours is elsewhere (for example Downloads), set it first in PowerShell:
   `$env:IL_CLOUDFLARED_PATH = "$HOME\Downloads\cloudflared.exe"`
   Do NOT set `IL_PUBLIC_HOST=0.0.0.0` — the tunnel does not need it and it exposes the file server to your whole Wi-Fi. Put file paths with spaces in quotes.
   The app also looks in `Program Files (x86)\cloudflared` and on your PATH (the `.msi` installer's usual location; not verified by me). You do not need to restart the app after adding the file.

## Part C: The real phone test (you must do this; I cannot)
Before you start: stop Windows from sleeping (Settings → System → Power → Screen and sleep → "Never" while plugged in). A sleeping PC drops the link.

1. **Pick a test video** that is really stored on this PC. If it is in OneDrive, right-click → **Always keep on this device**. Best: an `.mp4` (H.264) of 50-500 MB, so seeking is meaningful.
2. In InstantLink click **Start public connection**. Wait up to 30 seconds. The top pill should change to **"Public address created, checking…"** and then **"Public address answered (checked from this computer)"**.
   If it says *failed* or *not answering*, stop and send me the red message. **Do this step before creating the link.**
3. Click **Select File**, choose the video. Keep "24 hours" and "Allow download" ticked. Click **Create Link**, then **Copy Link**.
   The copied link must start with `https://` and contain `trycloudflare.com`. If it starts with `http://localhost`, the public connection is not on yet.
4. **Send the link to your phone** (WhatsApp "message yourself", Telegram Saved Messages, or email to yourself).
5. On the phone: **turn Wi-Fi OFF and mobile data ON.** Confirm the Wi-Fi icon is gone. Open the link in Chrome (Android) or Safari (iPhone).
6. Check and write down each result:
   | # | Check | Pass? |
   |---|---|---|
   | 1 | The page opens (file name, size, expiry shown) | |
   | 2 | Video starts playing (note how many seconds it took) | |
   | 3 | Drag the seek bar to about 80%: it resumes within a few seconds | |
   | 4 | Tap **Download**: the file downloads; its size matches the original | |
   | 5 | Open the link on a *second* phone or browser at the same time: both play | |
7. **Revoke:** in InstantLink, under *Active shares*, click **Revoke Link**. On the phone, reload the page. It must show **"Link revoked"**.
8. Click **Stop** (public connection). The pill returns to "Links work on this computer only".

**Report back:** phone model and browser, results 1-5, the pill text you saw, and any error text. Only after items 1-4 and the revoke check pass can we call external access *verified*.

## Try the receiver website on your PC
In the same Command Prompt: `npm run web`, then open http://localhost:8090 and choose a video from your PC. (Open it on your phone later, after it is deployed: see `DEPLOYMENT.md`.)

## Things to know
- The public address (`…trycloudflare.com`) **changes every time** you click Start. Links you copied earlier stop working; press **Copy Link** again.
- Everything works only while this PC is on, online, and InstantLink is open. Closing the window ends the tunnel.
- If InstantLink crashes, `cloudflared.exe` may keep running: end it in Task Manager.
- Windows file names like `CON`, `file.mp4:stream`, `desktop.ini`, and names ending in a dot/space are refused or hidden in shared folders. Sharing a whole drive (`C:\`) or your user folder is refused on purpose.
- `npm test` also works on Windows; a few tests that need symlinks or illegal file-name characters are **skipped** there and say so.
- Your data (shares, key) is in `%APPDATA%\instantlink\data` (source run) or `%APPDATA%\InstantLink\data` (installed app).
- Installer: `npm run dist:win` is provided but **untested**; the beginner route is `npm run desktop`.
