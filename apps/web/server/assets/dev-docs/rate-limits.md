# Rate limits

Per-minute and per-month allowances, and the headers that track them.

## The allowances

Two limits apply at once: a burst limit per minute, and a total per calendar month. Both follow the plan the account is on, and both are shared by every key on it.

| Plan | Requests per minute | Requests per month |
| --- | --- | --- |
| Free | 60 | 1,000 |
| Plus | 1,000 | 100,000 |

Your own numbers, and what you have spent against them, are on [the usage page](https://www.webbites.io/developers/docs/usage) and in `GET /usage`.

## The headers

Every response tells you where you stand, so you never have to guess:

| Header | What it says |
| --- | --- |
| `X-RateLimit-Limit` | Requests allowed in the current window. |
| `X-RateLimit-Remaining` | How many you have left in it. |
| `X-RateLimit-Reset` | When the window rolls over, as a unix timestamp. |
| `Retry-After` | Seconds to wait. Only sent with a 429. |

**Reading them**
```javascript
const res = await fetch(`${BASE}/bookmarks`, { headers })

const remaining = Number(res.headers.get('x-ratelimit-remaining'))
const resetsAt = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000)

if (remaining < 10) {
  console.warn(`${remaining} requests left until ${resetsAt.toLocaleTimeString()}`)
}
```

## Over the limit

Past either allowance you get a `429`. Wait for `Retry-After` and send the request again — nothing is lost, and the per-minute window clears in under a minute. A monthly allowance, on the other hand, only clears on the first of the month or when you change plan.

**Terminal**
```bash
curl -i https://api.webbites.io/v1/api/bookmarks -H "Authorization: Bearer $WEBBITES_KEY"

HTTP/1.1 429 Too Many Requests
Retry-After: 27
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
```

## Staying under it

- **Use webhooks instead of polling.** One delivery costs you nothing; checking a bookmark every three seconds costs twenty requests a minute.
- **Ask for bigger pages.** `limit=100` walks a library in a fifth of the requests `limit=20` needs.
- **Cache what does not change.** An old bookmark's title will be the same tomorrow.
- **Pace bulk work.** A sleep between saves is the difference between finishing and being throttled — the [import loop](https://www.webbites.io/developers/docs/saving-bookmarks) shows the shape.
- **Watch `X-RateLimit-Remaining`.** Slow down as it approaches zero rather than after you hit it.
