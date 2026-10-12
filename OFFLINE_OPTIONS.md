# Can a link work when the sender's device is off? The honest answer

**A video can only be served from a device that is on. If the only copy is on a switched-off phone or PC, no link can play it.**
To work while the sender is offline, the bytes must live somewhere that stays on. That means uploading them, and uploading takes time.
The best you can do is hide that time, which is option C.

| | A. Instant local share (built) | B. Persistent upload (not built) | C. Hybrid (not built) |
|---|---|---|---|
| Link ready | **instantly** (milliseconds) | only after the whole upload finishes | **instantly** |
| Works when sender's PC is off | **No** | **Yes** | No at first; **Yes after the background upload finishes** |
| Upload needed | none | full file, before the link exists | full file, but in the background, optional |
| Cost | none (uses sender's internet) | storage fees | storage fees (only if you choose to keep it) |
| Needs accounts/domain | optional (free cloudflared tunnel) | cloud storage account | storage account **and** a stable domain + small server |

## How long would an upload take? (arithmetic, not a measurement)
`minutes = size in GB × 8000 ÷ upload speed in Mbps ÷ 60`. 1 GB at 10 Mbps ≈ 13 min; at 50 Mbps ≈ 2.7 min. Home upload speeds are often the slowest part: this is exactly the wait InstantLink A avoids.

## Cost of cloud storage (Cloudflare R2, official pricing page read 2026-10-12, Standard storage)
Storage $0.015 per GB-month · Class A (writes) $4.50 per million · Class B (reads) $0.36 per million · **egress to viewers: $0** when served directly from R2 · free each month: 10 GB-month, 1 M Class A, 10 M Class B.
Example (arithmetic): a 2 GB video kept 30 days ≈ 2 × $0.015 = $0.03 a month, inside the 10 GB free tier. Other providers (S3, Backblaze) charge for bandwidth differently: not researched.
**Not researched:** domain price, hosting for a small server, whether R2 needs a payment card even for the free tier. Check before committing.

## What each persistent design needs
**Phase 1: "Make permanent" with your own R2 keys (simplest; can be built without a domain).**
The desktop app uploads (multipart, with progress) to a *private* bucket you own, then makes a *presigned link* that expires (S3-style presigned links have a maximum lifetime, 7 days on the S3 API: confirm for R2 before relying on it). Viewers play directly from R2 (supports Range). Limits: the link is long and **changes** (it is not the instant link), it expires within days, revoking means deleting the object. Your R2 keys live only on your computer.

**Phase 2: one stable link that survives (the hybrid).**
A small public server on your own domain (`https://share.yourdomain/s/<token>`) is the link. It serves from R2 if the video is there, otherwise forwards to the sender's PC if online, otherwise shows "sender offline". The desktop app asks the server for upload permission, so **R2 secrets stay on the server, never in the app or website**. Needs: domain, a host for the server (always on), R2, a database or file for share records, abuse handling, and a named Cloudflare tunnel (stable address) for the "forward to sender" part.

## Security and privacy of persistent storage
- The file is copied to a third party; they can technically read it unless you encrypt before upload (not planned for the first version).
- Private bucket only; viewers get short-lived links; expiry/revoke must also **delete** the object, or "revoked" would be a lie.
- Validate uploads: size limit, allowed types, never serve as HTML; do not trust the file name.
- You become a host of other people's files if you let anyone else use it: terms, copyright/abuse reports, takedowns.

## Recommendation for your goal (instant link, minimal waiting)
Keep **A** as the default (already built). Add **Phase 1** next (it needs only your R2 account). Do **Phase 2** only if you really need one stable link that works offline; it is a real service you must run and pay for.
