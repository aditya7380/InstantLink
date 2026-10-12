# Release checklist
Tick only what you actually did.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all pass
- [ ] `npm run test:e2e` passes
- [ ] `npm run dist` created the installer; started it on a clean machine
- [ ] **Public link tested from a phone on mobile data** (play + seek) — NOT done yet
- [ ] Tested in real Chrome, Safari, Firefox (desktop + phone)
- [ ] Built and tested on Windows and macOS (needs those machines) — NOT done yet
- [ ] Code-signing certificates obtained (Windows/macOS) — NOT done yet
- [ ] Cloudflare terms re-read for your usage; decision about named tunnel/domain
- [ ] Terms of use, privacy notice, abuse-report contact published — NOT done yet
- [ ] No secrets in the repo (`.env`, `secret.key`, keys); `npm audit --omit=dev` is clean
- [ ] Version bumped, release notes written
