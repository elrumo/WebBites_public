# Quickstart

From nothing to your first saved bookmark in about two minutes.

## 1. Create a key

Keys live on your account. Make one here — it works the moment it appears, and you can revoke it just as fast.

Keep it out of your shell history and out of any repository. Everything below assumes it is in an environment variable:

**Terminal**
```bash
export WEBBITES_KEY="wb_live_…"
```

## 2. Make your first call

`GET /bookmarks` returns your most recent saves. If this answers with JSON, everything else on this site will work too.

**cURL**
```bash
curl https://api.webbites.io/v1/api/bookmarks?limit=5 \
  -H "Authorization: Bearer $WEBBITES_KEY"
```

**JavaScript**
```javascript
const res = await fetch('https://api.webbites.io/v1/api/bookmarks?limit=5', {
  headers: { Authorization: `Bearer ${process.env.WEBBITES_KEY}` },
})

const { bookmarks } = await res.json()
console.log(bookmarks.map(b => b.title))
```

**Python**
```python
import os, requests

res = requests.get(
    "https://api.webbites.io/v1/api/bookmarks",
    params={"limit": 5},
    headers={"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"},
    timeout=30,
)
res.raise_for_status()

for bookmark in res.json()["bookmarks"]:
    print(bookmark["title"])
```

You get back an array and a cursor:

**Response**
```json
{
  "bookmarks": [
    {
      "id": "abc123",
      "url": "https://example.com",
      "title": "Example",
      "type": "website",
      "tags": ["docs"],
      "createdAt": "2026-01-02T10:00:00.000Z"
    }
  ],
  "nextBefore": "2026-01-02T10:00:00.000Z"
}
```

## 3. Save something

`POST /bookmarks` needs a `url` and takes optional `tags` and a `note`. It answers immediately, before the page has been fetched.

**cURL**
```bash
curl -X POST https://api.webbites.io/v1/api/bookmarks \
  -H "Authorization: Bearer $WEBBITES_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://nuxt.com","tags":["reading","vue"],"note":"For the docs rewrite"}'
```

**JavaScript**
```javascript
const res = await fetch('https://api.webbites.io/v1/api/bookmarks', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.WEBBITES_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://nuxt.com',
    tags: ['reading', 'vue'],
    note: 'For the docs rewrite',
  }),
})

const bookmark = await res.json()
console.log(bookmark.id, bookmark.status)
```

**Python**
```python
import os, requests

res = requests.post(
    "https://api.webbites.io/v1/api/bookmarks",
    json={"url": "https://nuxt.com", "tags": ["reading", "vue"], "note": "For the docs rewrite"},
    headers={"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"},
    timeout=30,
)
res.raise_for_status()
print(res.json()["id"])
```

**Response**
```json
{
  "id": "abc123",
  "url": "https://nuxt.com",
  "status": "processing"
}
```

> `"status": "processing"` means the screenshot, summary and automatic tags are still being generated. Read [Saving bookmarks](https://www.webbites.io/developers/docs/saving-bookmarks) for the two ways to find out when they land.

## 4. Where to go next

- [Searching & paging](https://www.webbites.io/developers/docs/searching) — filters, full-text search and walking the whole library.
- [Webhooks](https://www.webbites.io/developers/docs/webhooks) — get pushed the finished bookmark instead of polling for it.
- [Recipes](https://www.webbites.io/developers/docs/recipes) — a backup script, a Slack command and a digest you can copy whole.
- [Playground](https://www.webbites.io/developers/docs/playground) — try any endpoint from the browser.
