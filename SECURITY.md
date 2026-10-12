# Security (as of 2026-10-11)

## Implemented and covered by automated tests
- 256-bit random tokens. The server stores a SHA-256 hash for lookup; for "copy link again" an AES-256-GCM encrypted copy is stored with a local key (`secret.key`, mode 0600). Tampered/wrong-key data is rejected.
- Expiry and revocation checked server-side on every request. Revoked links return 410 immediately; revoked tokens cannot be revealed again.
- Path traversal (`..`, %2e, double-encoding, backslash, absolute, NUL), symlink escapes, swapped-in symlinks, and hidden files (`.env`) are refused.
- Public server exposes no admin routes. In the desktop app the admin API has **no network port**; the UI reaches it only through validated Electron IPC. CLI mode keeps it on 127.0.0.1 with a secret key and a localhost `Host` check.
- Electron: contextIsolation, sandbox, no nodeIntegration, preload exposes only 13 named functions, IPC accepted only from our own page, navigation and new windows blocked, every IPC input validated, "open link" restricted to our own address. Verified in the running app: the page has no `require`/`process`.
- Rate limiting per real viewer address; tokens redacted from logs; `no-store`, `no-referrer`, `nosniff`, `noindex`, strict CSP on pages; HTML-escaped file names; files never served as HTML; verify only fetches our own address (no SSRF).
- Changed file after link creation → 409 instead of silently serving different content.

## Added for Windows (tested by simulation only; see WINDOWS.md)
- Shared folders refuse/hide Windows tricks: NTFS alternate streams (`file:stream`), device names (`CON`, `NUL`, `COM1`), trailing dot/space, `desktop.ini`, `Thumbs.db`, `NTUSER.DAT*`, `$RECYCLE.BIN`.
- Containment check is case-insensitive on Windows and correct for drive roots. Sharing a whole drive, the user folder, or a folder that contains it is refused.
- The admin API still has no network port in the desktop app; nothing about the Windows changes exposes it.
- File permissions (0600/0700) are ignored on Windows; `%APPDATA%` is protected by the normal per-user folder permissions.

## Known issues / residual risks
- **`secret.key` sits next to `shares.json`.** Encryption only helps if someone gets `shares.json` alone (e.g. a backup). Any program running as your user can read both and recover active links. OS keychain storage is not implemented.
- Anyone with a link can open it; no passwords, no per-link view limits (not implemented).
- Public tunnel not externally verified (`PUBLIC_ACCESS.md`). Quick-tunnel addresses are public and unauthenticated.
- No abuse-report workflow or terms of service yet; required before offering this to other people.
- Check-then-open race on a path is reduced (real-path check + snapshot compare), not eliminated.
- Dependencies: `npm audit --omit=dev` = 0 issues for what ships. `npm audit` (all) = 8 moderate issues, all in the **build tooling** (electron-builder chain, `sprintf-js` DoS); they are not in the shipped app. The suggested fix is a breaking downgrade, so it was not applied.
- AppImage is unsigned; no auto-update; not independently audited.
