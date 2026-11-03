# Saving bookmarks

What happens after POST /bookmarks, and how to wait for the enriched version.

## Save a URL

One required field, two optional ones. `tags` is a comma separated list, and `note` is free text that stays yours — nothing overwrites it later.

**Request**
```bash
curl -X POST https://api.webbites.io/v1/api/bookmarks \
  -H "Authorization: Bearer $WEBBITES_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","tags":["research","ai"],"note":"Cited in the Q3 deck"}'
```

**Response**
```json
{
  "id": "abc123",
  "url": "https://example.com",
  "status": "processing"
}
```

## What happens next

The response comes back before the page has been fetched, so the bookmark you get is a stub. In the background we then fetch the page and fill in:

- **title and description** from the page's own metadata;
- **image, favicon and a full-page screenshot**;
- **a summary** of what the page says;
- **automatic tags**, added to the ones you passed;
- **type** — `website`, `article`, `image` and friends.

How long it takes depends on the page. Most finish in seconds; a slow or heavy site takes longer. Sites that block automated fetching, or sit behind a login or a paywall, come back with whatever we could reach — the bookmark is still saved, just thinner.

## Waiting for the finished version

### The good way: a webhook

Register an endpoint once and we POST the finished bookmark to it, no polling and no wasted quota. This is what the [webhooks guide](https://www.webbites.io/developers/docs/webhooks) is for.

### The simple way: poll the bookmark

For a one-off script, re-reading `GET /bookmarks/:id` until `summary` fills in is fine. Space the checks out — every request counts against your [rate limit](https://www.webbites.io/developers/docs/rate-limits).

**poll.js**
```javascript
const KEY = process.env.WEBBITES_KEY
const headers = { Authorization: `Bearer ${KEY}` }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function saveAndWait(url, { attempts = 10, every = 3000 } = {}) {
  const created = await fetch('https://api.webbites.io/v1/api/bookmarks', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).then(r => r.json())

  for (let i = 0; i < attempts; i++) {
    await sleep(every)
    const bookmark = await fetch(`https://api.webbites.io/v1/api/bookmarks/${created.id}`, { headers })
      .then(r => r.json())
    // The summary is the last thing to land, so it is the signal to stop.
    if (bookmark.summary) return bookmark
  }

  // Still processing. It will finish; this script just stopped waiting.
  return created
}
```

## Saving a lot at once

There is no batch endpoint: a bulk import is a loop over `POST /bookmarks`. Keep it sequential, or at most two or three at a time, and let the per-minute allowance set the pace. A script that fires a thousand requests at once gets `429`s and finishes later than one that paces itself.

**import.js**
```javascript
const urls = ['https://a.example', 'https://b.example' /* … */]
const headers = {
  Authorization: `Bearer ${process.env.WEBBITES_KEY}`,
  'Content-Type': 'application/json',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const save = url => fetch('https://api.webbites.io/v1/api/bookmarks', {
  method: 'POST',
  headers,
  body: JSON.stringify({ url, tags: ['imported'] }),
})

for (const url of urls) {
  let res = await save(url)

  if (res.status === 429) {
    // Wait out the window the server asked for, then give it one more go.
    await sleep(Number(res.headers.get('retry-after') || 60) * 1000)
    res = await save(url)
  }

  if (!res.ok) console.error('skipped', url, res.status)
  await sleep(1100) // ~55 saves a minute, comfortably inside the free plan
}
```

> Importing browser bookmarks rather than a list of URLs? The app's [import guide](https://www.webbites.io/export-bookmarks) does it in a few clicks, without any code.
