# Errors & retries

The status codes you will meet and what to do about each one.

## Status codes

The HTTP status is the part to branch on. Anything in the `2xx` range worked; everything else comes back with a body describing what went wrong.

| Status | Meaning | What to do |
| --- | --- | --- |
| `400` | Bad request | A parameter is missing or malformed — most often a POST /bookmarks without a url. |
| `401` | Unauthorized | No Authorization header, or the key has been revoked. Check the header reads Bearer wb_live_…. |
| `403` | Forbidden | The key is valid but the resource belongs to another account. |
| `404` | Not found | No bookmark or webhook with that id on your account. |
| `429` | Too many requests | You hit the per-minute or per-month limit. Wait for Retry-After and try again. |
| `5xx` | Server error | Our side. Retry with backoff — the request was not necessarily discarded. |

## Handling them in code

`fetch` only rejects on a network failure, so a `401` looks like a success until you check `res.ok`. Check it on every call, and keep the response body — it is the part that says which field was wrong.

**webbites.js**
```javascript
const BASE = 'https://api.webbites.io/v1/api'

export class WebBitesError extends Error {
  constructor(status, body) {
    super(`WebBites API ${status}: ${body}`)
    this.status = status
    this.body = body
  }
}

export async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.WEBBITES_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (!res.ok) throw new WebBitesError(res.status, await res.text())
  return res.status === 204 ? null : res.json()
}
```

## Retrying safely

Retry `429` and `5xx`; don't retry `400`, `401`, `403` or `404`, because the same request will fail the same way. For a `429`, wait the number of seconds in `Retry-After` rather than guessing.

**retry.js**
```javascript
const RETRYABLE = new Set([429, 500, 502, 503, 504])
const sleep = ms => new Promise(r => setTimeout(r, ms))

const authed = (options = {}) => ({
  ...options,
  headers: {
    Authorization: `Bearer ${process.env.WEBBITES_KEY}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  },
})

export async function callWithRetry(path, options = {}, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(BASE + path, authed(options))
    if (res.ok) return res.json()

    if (!RETRYABLE.has(res.status) || attempt === attempts) {
      throw new WebBitesError(res.status, await res.text())
    }

    // The server's own number first; otherwise back off exponentially.
    const retryAfter = Number(res.headers.get('retry-after'))
    await sleep(retryAfter ? retryAfter * 1000 : 2 ** attempt * 500)
  }
}
```

> ⚠️ `POST /bookmarks` is not idempotent: a retry after a request that actually succeeded leaves you with the same page saved twice. Retry a save only when you never saw a response, and de-duplicate on `url` if it matters to you.

## When the answer looks wrong

- **A bookmark came back thin** — no summary, no screenshot. It is probably still processing; read it again in a few seconds. See [Saving bookmarks](https://www.webbites.io/developers/docs/saving-bookmarks).
- **It stays thin.** Some sites block automated fetching or sit behind a login, and we save what we can reach. Editing the bookmark in the app fixes it for good.
- **401 with a key you just made.** Check the header is `Authorization: Bearer wb_live_…` and that nothing trimmed the prefix — a shell variable that was never exported is the usual culprit.
- **Everything 429s.** Look at `X-RateLimit-Remaining` on any response and at [your usage](https://www.webbites.io/developers/docs/usage): a monthly allowance that has run out looks exactly like a burst that was too fast.

Still stuck? [Tell us what you sent and what came back](https://www.webbites.io/support) — the request, the status and the body are enough to find it.
