# Roadmap and open risks (updated 2026-10-11)

## Done
Local engine · desktop app · re-copyable links · tunnel integration (unverified externally) · Linux AppImage · automated + e2e tests.

## Next (in this order)
1. **Verify public access for real** (phone on mobile data). Then decide: stay on quick tunnel, or named tunnel + domain.
2. Test in real Chrome/Safari/Firefox; build Windows/macOS on those systems.
3. Password-protected links; per-link view limits.
4. Terms of use + abuse-report contact before giving it to others.
5. Optional permanent cloud hosting (explicit consent, resumable upload, cost disclosure). **Not implemented.**
6. Code signing, auto-update, OS-keychain storage for the link key.

## Missing-requirements register
| Risk | Severity | Blocks release? | Status |
|---|---|---|---|
| Public access never verified from outside | High | Yes | open: needs your phone test |
| Quick tunnel: no uptime guarantee, changing URL, unclear heavy-video terms | High | For serious use | open |
| Only Chromium-based browsers tested | Med | Yes | open |
| Windows/macOS not built | Med | For those users | open |
| `secret.key` readable by any program running as the user | Med | No (disclosed) | open |
| No passwords / abuse workflow / terms | Med | Before sharing with others | open |
| Computer must stay on and online | Med | No (disclosed in the app) | by design in local mode |
| Codec unsupported in recipient browser | Med | No | page explains; download fallback |
| Build-tool audit findings (8 moderate) | Low | No (not shipped) | open |
