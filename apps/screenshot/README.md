# apps/screenshot

Small Playwright service that gives WebBites bookmark screenshots and JS-rendered page text.
It is optional: without it, bookmark cards use the page's own preview image.

| Endpoint | Body | Answer |
|---|---|---|
| `POST /screenshot` | `{ url, quality?: "standard" \| "high", fullPage?, removeAds? }` | `{ base64, mime, bytes }` |
| `POST /render` | `{ url, blockAds? }` | `{ html, finalUrl }` |
| `GET /health` | | `{ ok: true }` |

Both POST endpoints need the `X-API-Key` header (`SCREENSHOT_API_KEY`).

## Safety

Every request the browser makes (the page, redirects, images, scripts) is checked against private,
loopback, link-local and metadata ranges, and `*.local` / `*.internal` / dot-less names are refused.
Run it on its own Docker network that has only the API on it (the compose file does).

## Settings

| Variable | Default | |
|---|---|---|
| `SCREENSHOT_API_KEY` | required | shared secret with the API |
| `PORT` | `3000` | |
| `MAX_CONCURRENCY` | `3` | pages rendered at once; each needs roughly 300 MB |
| `MAX_QUEUE` | `50` | requests waiting beyond that get 503 |
| `NAV_TIMEOUT_MS` | `30000` | |
| `REQUEST_TIMEOUT_MS` | `80000` | |
| `MAX_FULLPAGE_HEIGHT` | `12000` | px, tall pages are cut here |
| `ALLOW_PRIVATE_URLS` | `false` | tests only |
