# Searching & paging

Filter by text, tag and type, then walk the whole library with a cursor.

## Filters

`GET /bookmarks` returns your library newest first. Every filter is a query parameter, and they combine — `?q=rust&tag=reading&type=article` is an article, tagged reading, mentioning rust.

| Parameter | Does what | Example |
| --- | --- | --- |
| `q` | Full-text search across your library. | `q=postgres` |
| `tag` | Only bookmarks carrying this tag. | `tag=reading` |
| `type` | Only this kind of bookmark. | `type=article` |
| `limit` | How many rows to return. Defaults to 50. | `limit=100` |
| `before` | A cursor from a previous response’s nextBefore. | `before=2026-01-02T10:00:00.000Z` |

**cURL**
```bash
curl -G https://api.webbites.io/v1/api/bookmarks \
  -H "Authorization: Bearer $WEBBITES_KEY" \
  --data-urlencode "q=rust" \
  --data-urlencode "tag=reading" \
  --data-urlencode "type=article" \
  --data-urlencode "limit=20"
```

**JavaScript**
```javascript
const params = new URLSearchParams({ q: 'rust', tag: 'reading', type: 'article', limit: '20' })

const { bookmarks } = await fetch(`https://api.webbites.io/v1/api/bookmarks?${params}`, {
  headers: { Authorization: `Bearer ${process.env.WEBBITES_KEY}` },
}).then(r => r.json())
```

**Python**
```python
import os, requests

res = requests.get(
    "https://api.webbites.io/v1/api/bookmarks",
    params={"q": "rust", "tag": "reading", "type": "article", "limit": 20},
    headers={"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"},
    timeout=30,
)
bookmarks = res.json()["bookmarks"]
```

## Full-text search

`q` runs the same full-text search the app runs, over the text we hold for a bookmark rather than over the live page. A query that finds something in the app finds it here too.

Search is a filter like any other, which means it pages the same way — don't assume the first response is all of it.

## Paging through everything

Paging is cursor based. Each response carries `nextBefore`: pass it back as `before` to get the page after it. When a response comes back with fewer rows than you asked for, or without a `nextBefore`, you have reached the end.

**JavaScript**
```javascript
const headers = { Authorization: `Bearer ${process.env.WEBBITES_KEY}` }

async function* everything({ pageSize = 100, ...filters } = {}) {
  let before = null

  while (true) {
    const params = new URLSearchParams({ ...filters, limit: String(pageSize) })
    if (before) params.set('before', before)

    const page = await fetch(`https://api.webbites.io/v1/api/bookmarks?${params}`, { headers })
      .then(r => r.json())

    for (const bookmark of page.bookmarks) yield bookmark

    // No cursor, or a short page: that was the last one.
    if (!page.nextBefore || page.bookmarks.length < pageSize) return
    before = page.nextBefore
  }
}

for await (const bookmark of everything({ tag: 'reading' })) {
  console.log(bookmark.createdAt, bookmark.title)
}
```

**Python**
```python
import os, requests

HEADERS = {"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"}


def everything(page_size=100, **filters):
    before = None

    while True:
        params = {**filters, "limit": page_size}
        if before:
            params["before"] = before

        page = requests.get(
            "https://api.webbites.io/v1/api/bookmarks", params=params, headers=HEADERS, timeout=30
        ).json()

        yield from page["bookmarks"]

        before = page.get("nextBefore")
        if not before or len(page["bookmarks"]) < page_size:
            return


for bookmark in everything(tag="reading"):
    print(bookmark["createdAt"], bookmark["title"])
```

> The cursor is the `createdAt` of the last row, so a bookmark saved *while* you are paging appears at the front — in a page you have already passed — rather than duplicating itself further down.

## Types

`type` is what kind of thing a bookmark is, decided when it is saved: `website`, `article`, `image`, `textNote` and the other kinds the app shows in its type filter. Filter on it when you want, say, only the long reads:

**Request**
```bash
curl -G https://api.webbites.io/v1/api/bookmarks \
  -H "Authorization: Bearer $WEBBITES_KEY" \
  --data-urlencode "type=article" \
  --data-urlencode "limit=10"
```
