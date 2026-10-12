# Decisions

| # | Decision | Why | Trade-off / revisit when |
|---|----------|-----|--------------------------|
| 1 | Node 22 + TypeScript + Fastify | streaming APIs, small surface | — |
| 2 | Engine and CLI first, then Electron on top of the same code | the UI calls the real backend; nothing is mocked | — |
| 3 | JSON file store with atomic writes (not SQLite) | no native dependency, survives restarts | move to SQLite if thousands of shares |
| 4 | Token: SHA-256 hash for lookup + AES-256-GCM encrypted copy so the owner can "Copy Link" again | users must be able to re-copy links | key is stored beside the data; OS keychain would be stronger |
| 5 | Desktop admin API runs in-process, no network port (IPC only) | no other program or web page can call it | CLI mode still uses localhost + secret key |
| 6 | Public server binds 127.0.0.1; internet access only via the tunnel | no direct exposure | LAN sharing would need an explicit opt-in (CLI env var) |
| 7 | Cloudflare quick tunnel through the `cloudflared` binary (not bundled) | free, no account, HTTPS, simplest | no uptime guarantee, changing address, unverified externally, terms for heavy video unclear. Alternatives: named tunnel (needs domain), VPS relay (bandwidth cost) |
| 8 | Changed file ⇒ 409, never silently different content | recipients must not be surprised | add snapshot/versioning later |
| 9 | Share page has no JavaScript and a strict CSP | nothing to exploit via file names | richer player later needs a nonce CSP |
| 10 | AppImage only (no .deb) | `.deb` needs a project homepage, which does not exist; no fake URL was invented | add when a real site exists |
| 11 | Permanent cloud hosting and passwords not built | cannot be configured/tested here; would be untested security code | next stages |
| 12 | Windows beginners run from source (`npm run desktop`) and drop `cloudflared.exe` next to `package.json` | docs do not say where the Windows installer puts `cloudflared` or whether it is on PATH; a visible folder is the least fragile; PATH and Program Files are also searched | `npm run dist:win` installer exists but is untested; the app could download `cloudflared` itself later (needs a checksum design) |
| 13 | Refuse drive-root / home-folder shares | a beginner picking `C:\Users\Name` would publish `AppData` (browser profiles) | cannot share a whole folder tree by choice; share a specific subfolder |
| 14 | Receiver mode is a static website (`web/`), no backend | local playback needs no server; fewest moving parts; a CSP `connect-src 'none'` makes "never uploaded" enforced by the browser, not just promised | cannot create links by itself |
| 15 | Persistent/offline sharing is a documented, separate decision (`OFFLINE_OPTIONS.md`), not silently built | needs accounts, money and a stable domain; physics: bytes must be uploaded | Phase 1 (own R2 keys) recommended next |

