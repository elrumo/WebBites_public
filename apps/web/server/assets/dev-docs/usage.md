# Usage

What you have spent this month, per key.

## This month

Your plan, what it allows and what you have spent against it — the same numbers the API returns, broken down by key.

On the live page this is an interactive panel (sign-in required, since usage is counted per account across every key). It shows your current plan tier, this month's request count against your monthly allowance with a progress meter, your per-minute limit, how many requests are left this month, a per-key breakdown and, when AI assistants have made calls, a per-assistant one, plus a refresh button. It reads the same figures the API returns from `GET /usage`.

## Checking usage from code

`GET /usage` returns all of it. Worth calling at the start of a long job: if the month's allowance cannot cover the work, you would rather know before you start than half way through.

```bash
curl https://api.webbites.io/v1/api/usage \
  -H "Authorization: Bearer $WEBBITES_KEY"
```

```json
{
  "tier": "plus",
  "limits": { "perMinute": 300, "perMonth": 20000 },
  "usage": {
    "month": "2026-10",
    "total": 412,
    "byKey": { "wb_live_…": 400 },
    "byGrant": { "Xq3kR8pLmZ": 12 }
  }
}
```

```javascript
const usage = await fetch(`${BASE}/usage`, { headers }).then(r => r.json())

const left = usage.limits.perMonth - usage.usage.total
if (left < urls.length) {
  throw new Error(`Need ${urls.length} requests, ${left} left this month.`)
}
```

## What counts

- **Requests you make against the API** are what the allowance covers — every call in this list of endpoints, however small.
- **Deliveries we send you** are ours to make, not requests you made, which is the main reason to prefer a webhook over polling.
- **Using the app, the extension or the native apps** is not API traffic and does not appear here.
- **Limits are per account**, shared across every key. `byKey` tells you which key spent what.
- **Tool calls from AI assistants** count too, one request per call. An assistant connected by signing in is counted per connection in `byGrant`; one using an API key counts against that key. See [MCP server](https://www.webbites.io/developers/docs/mcp).

Running out of month rather than out of minute? The plans are on the [pricing section](https://www.webbites.io/#pricing), and [Rate limits](https://www.webbites.io/developers/docs/rate-limits) lists what each one allows.
