# Webhooks

Get a POST the moment a bookmark finishes processing — and verify it is us.

## What they are for

Saving is asynchronous, so something has to tell you when a bookmark is finished. A webhook is that something: register an HTTPS endpoint and we POST the whole enriched bookmark to it as soon as the screenshot, summary and tags are in. No polling, no wasted quota.

There is one event today:

- `bookmark.saved` — a bookmark finished processing. It fires for saves made from the API, the app and the extension alike.

## Register an endpoint

Add one here, or with `POST /webhooks`. Either way the response carries the signing secret — copy it once and keep it with your other secrets.

**Request**
```bash
curl -X POST https://api.webbites.io/v1/api/webhooks \
  -H "Authorization: Bearer $WEBBITES_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/webhooks/webbites","description":"digest builder"}'
```

**Response**
```json
{
  "id": "wh_1",
  "url": "https://example.com/webhooks/webbites",
  "events": ["bookmark.saved"],
  "active": true,
  "secret": "whsec_…"
}
```

## The delivery

Each delivery is a JSON POST with the event name, a delivery id and the bookmark itself:

**Body**
```json
{
  "id": "dlv_…",
  "event": "bookmark.saved",
  "createdAt": "2026-01-02T10:00:00.000Z",
  "data": {
    "id": "abc123", "url": "https://example.com", "title": "Example", "description": "…",
    "type": "website", "tags": ["docs"], "note": "", "summary": "…",
    "image": "https://…", "screenshot": "https://…", "favicon": "https://…",
    "createdAt": "2026-01-02T10:00:00.000Z"
  }
}
```

And these headers:

| Header | What it carries |
| --- | --- |
| `X-WebBites-Event` | The event name, e.g. bookmark.saved. |
| `X-WebBites-Delivery` | Unique delivery id. Use it to de-duplicate retries. |
| `X-WebBites-Signature` | sha256=<hex HMAC-SHA256(secret, raw body)>. |

Answer `2xx` quickly. Do the real work after you have replied — a handler that keeps the connection open while it thinks looks like a broken endpoint.

## Verify the signature

`X-WebBites-Signature` is an HMAC-SHA256 of the **raw** request body, keyed with your webhook's secret. Verify it before you trust a delivery — anyone can POST to a public URL.

**Node**
```javascript
import crypto from 'node:crypto'

// rawBody must be the untouched request body (a Buffer or string), not re-serialised JSON.
function verify(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return expected.length === signatureHeader.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
}
```

**Python**
```python
import hashlib
import hmac


def verify(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """raw_body must be the untouched request body, not a re-serialised dict."""
    expected = "sha256=" + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

> ⚠️ Sign the bytes you received, not a re-serialised object. `JSON.stringify(req.body)` reorders keys and drops whitespace, and the signature stops matching. In Express that means `express.raw()` on the webhook route.

## A receiver, end to end

Express, raw body, signature check, fast reply:

**server.js**
```javascript
import express from 'express'
import crypto from 'node:crypto'

const app = express()
const SECRET = process.env.WEBBITES_WEBHOOK_SECRET
const seen = new Set() // swap for Redis or a table once this matters

// express.raw keeps the exact bytes we signed.
app.post('/webhooks/webbites', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.get('X-WebBites-Signature') || ''
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(req.body).digest('hex')

  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return res.status(401).end()
  }

  const delivery = req.get('X-WebBites-Delivery')
  if (seen.has(delivery)) return res.status(200).end() // a retry of something we handled
  seen.add(delivery)

  const { event, data } = JSON.parse(req.body.toString('utf8'))

  // Reply first, work afterwards.
  res.status(200).end()

  if (event === 'bookmark.saved') {
    queue.add(() => index(data)) // your job queue, your indexing
  }
})

app.listen(3000)
```

## Retries and duplicates

A delivery that fails is retried, so your handler must be safe to run twice with the same payload. `X-WebBites-Delivery` is unique per delivery and stable across retries of it — keep the last few thousand ids and drop anything you have already seen.

Repeated failures are counted per webhook, and the panel above shows the count, the last status your endpoint answered with and when it last heard from us. The **Test** button sends a sample delivery on demand, which is the fastest way to check a new receiver — including against a tunnel while you are still developing it.
