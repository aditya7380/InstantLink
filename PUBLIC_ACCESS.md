# Public access (letting people on other networks open your link)

## What is implemented
InstantLink starts `cloudflared` (a Cloudflare "quick tunnel") which gives your **public file server only** an `https://….trycloudflare.com`
address. The admin API is never exposed (it has no network port in the desktop app). Rate limiting uses the real viewer address
(`CF-Connecting-IP`, trusted only when the request comes from this computer's loopback).

The app shows three separate facts, and never merges them:
1. *Link created.* 2. *Tunnel connected* (an address exists). 3. *Reachable*: our own server answered a request sent to that public address.
The note in the app says so: this check runs **from your computer**, so confirm on a phone using mobile data.

## What is NOT verified (important)
- **No external test was possible.** In the build environment `api.trycloudflare.com` could not be resolved (network allowlist), so no tunnel was ever started and no outside device opened a link. The tunnel code is tested only against a fake tunnel program (`test/tunnel.test.ts`) and the "cloudflared missing" path in the real app.
- **Video/bandwidth terms:** Cloudflare's CDN terms restrict video/large files served from outside Cloudflare's own products. I read the Application Services terms, the Zero Trust terms, and the Online Services terms (checked 2026-10-11): none mentions Tunnel or sets a video/bandwidth limit for it, but none *confirms* Tunnel video sharing is allowed either. Official docs say quick tunnels are for testing, have **no uptime guarantee**, change address on every start, and cap at 200 simultaneous requests. Cloudflare may suspend access at any time. **Treat this as a free test route, not a production guarantee.** Ask Cloudflare or read the Self-Serve Subscription Agreement before relying on it for heavy use.

## Steps for you (beginner)
1. Install `cloudflared` from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ (no account needed for quick tunnels).
   On Linux you can also put the downloaded file somewhere and set `IL_CLOUDFLARED_PATH=/full/path/cloudflared`.
2. Open InstantLink, create a link, click **Start public connection** (takes up to 30 s).
3. Wait for the status to say connected, then **Copy Link**.
4. **Verify for real:** send the link to a phone, turn Wi-Fi off (mobile data), open it, play the video, drag the seek bar. Only then is it verified.
5. When your computer sleeps, closes InstantLink or loses internet, the link stops working for everyone. The app shows "connection dropped".

## For reliable, stable links (needs your account + a domain)
A *named tunnel* gives a stable address on your own domain but needs a Cloudflare account and a domain you own (domain price varies by registrar; **not researched here**).
Not implemented in the app yet. Alternative: a VPS relay (you pay bandwidth for every viewer; not built).

## Costs (what is known)
| Item | Cost | Status |
|---|---|---|
| InstantLink local sharing | no cloud cost; uses your upload bandwidth | measured behaviour |
| Cloudflare quick tunnel | no fee stated in the docs read | no uptime guarantee |
| Domain / named tunnel / VPS / cloud storage | not researched | unknown, do not assume |
