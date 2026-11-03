# Recipes

Six small programs you can copy, in JavaScript or Python: a Slack command, a digest, a reading list, a star mirror, a notes sync, a backup.

Each is complete — set `WEBBITES_KEY` and run it. Every snippet is given in both JavaScript and Python. The base URL is `https://api.webbites.io/v1/api`.

Ideas covered: A Slack "/save" command (`POST /bookmarks`), A weekly digest (`GET /bookmarks`), A public reading list (`GET /bookmarks?tag=`), Mirror your GitHub stars (`POST /bookmarks`), Sync into your notes (`bookmark.saved`), Nightly backups (`GET /bookmarks`).

## A Slack "/save" command

Type `/save https://example.com tag:reading` in Slack and it lands in your library. Slack wants a reply within three seconds, so answer first and save afterwards.

**JavaScript**

```javascript
import express from 'express'

const app = express()
const BASE = 'https://api.webbites.io/v1/api'

app.post('/slack/save', express.urlencoded({ extended: true }), async (req, res) => {
  // Slack sends the whole command line as one string: "https://… tag:reading"
  const words = (req.body.text || '').trim().split(/\s+/)
  const url = words.find(w => w.startsWith('http'))
  const tags = words.filter(w => w.startsWith('tag:')).map(w => w.slice(4))

  if (!url) return res.json({ text: 'Give me a URL to save.' })

  // Answer inside Slack's three second window, then do the work.
  res.json({ response_type: 'in_channel', text: `Saving ${url}…` })

  const saved = await fetch(`${BASE}/bookmarks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WEBBITES_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, tags: tags.length ? tags : undefined }),
  }).then(r => r.json())

  // The response_url lets you edit that first reply once you know how it went.
  await fetch(req.body.response_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replace_original: true,
      text: saved.id ? `Saved — it will finish processing in a moment.` : 'That did not save.',
    }),
  })
})

app.listen(3000)
```

**Python**

```python
import os
import threading

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)
BASE = "https://api.webbites.io/v1/api"


def save(url, tags, response_url):
    saved = requests.post(
        f"{BASE}/bookmarks",
        json={"url": url, "tags": tags or None},
        headers={"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"},
        timeout=30,
    ).json()
    # response_url lets you edit that first reply once you know how it went.
    requests.post(
        response_url,
        json={
            "replace_original": True,
            "text": "Saved — it will finish processing in a moment."
            if saved.get("id")
            else "That did not save.",
        },
        timeout=30,
    )


@app.post("/slack/save")
def slack_save():
    # Slack sends the whole command line as one string: "https://… tag:reading"
    words = (request.form.get("text") or "").split()
    url = next((w for w in words if w.startswith("http")), None)
    tags = [w[4:] for w in words if w.startswith("tag:")]

    if not url:
        return jsonify(text="Give me a URL to save.")

    # Answer inside Slack's three second window, then do the work.
    threading.Thread(target=save, args=(url, tags, request.form["response_url"])).start()
    return jsonify(response_type="in_channel", text=f"Saving {url}…")
```

In production, verify Slack's own `X-Slack-Signature` header before you act on a request — the same idea as verifying [our webhook signature](https://www.webbites.io/developers/docs/webhooks), with Slack's secret.

## A weekly digest

What did you save this week? This groups the last seven days by tag and prints markdown you can paste into a newsletter, a standup note or an email.

**JavaScript**

```javascript
const BASE = 'https://api.webbites.io/v1/api'
const headers = { Authorization: `Bearer ${process.env.WEBBITES_KEY}` }
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

const byTag = new Map()
let before = null
let done = false

while (!done) {
  const params = new URLSearchParams({ limit: '100' })
  if (before) params.set('before', before)

  const page = await fetch(`${BASE}/bookmarks?${params}`, { headers }).then(r => r.json())

  for (const bookmark of page.bookmarks) {
    // Newest first, so the first one older than the window ends the walk.
    if (new Date(bookmark.createdAt) < since) { done = true; break }
    for (const tag of bookmark.tags?.length ? bookmark.tags : ['untagged']) {
      byTag.set(tag, [...(byTag.get(tag) || []), bookmark])
    }
  }

  before = page.nextBefore
  if (!before) done = true
}

console.log(`# Saved since ${since.toISOString().slice(0, 10)}\n`)
for (const [tag, items] of [...byTag].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${tag} (${items.length})`)
  for (const b of items) console.log(`- [${b.title}](${b.url})`)
  console.log()
}
```

**Python**

```python
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

BASE = "https://api.webbites.io/v1/api"
HEADERS = {"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"}
SINCE = datetime.now(timezone.utc) - timedelta(days=7)

by_tag = defaultdict(list)
before = None
done = False

while not done:
    params = {"limit": 100}
    if before:
        params["before"] = before

    page = requests.get(f"{BASE}/bookmarks", params=params, headers=HEADERS, timeout=30).json()

    for bookmark in page["bookmarks"]:
        saved_at = datetime.fromisoformat(bookmark["createdAt"].replace("Z", "+00:00"))
        # Newest first, so the first one older than the window ends the walk.
        if saved_at < SINCE:
            done = True
            break
        for tag in bookmark.get("tags") or ["untagged"]:
            by_tag[tag].append(bookmark)

    before = page.get("nextBefore")
    if not before:
        done = True

print(f"# Saved since {SINCE:%d %b}\n")
for tag, items in sorted(by_tag.items(), key=lambda kv: -len(kv[1])):
    print(f"## {tag} ({len(items)})")
    for bookmark in items:
        print(f"- [{bookmark['title']}]({bookmark['url']})")
    print()
```

## A public reading list

Everything under one tag, turned into a static HTML page you can host anywhere. New save, new entry, no CMS — run it whenever the tag changes, or on a schedule.

**JavaScript**

```javascript
import { writeFile } from 'node:fs/promises'

const BASE = 'https://api.webbites.io/v1/api'
const TAG = 'reading'
const headers = { Authorization: `Bearer ${process.env.WEBBITES_KEY}` }

// Everything under one tag, newest first.
const items = []
let before = null
while (true) {
  const params = new URLSearchParams({ tag: TAG, limit: '100' })
  if (before) params.set('before', before)
  const page = await fetch(`${BASE}/bookmarks?${params}`, { headers }).then(r => r.json())
  items.push(...page.bookmarks)
  if (!page.nextBefore || page.bookmarks.length < 100) break
  before = page.nextBefore
}

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const rows = items
  .map(b => `  <li><a href="${esc(b.url)}">${esc(b.title || b.url)}</a></li>`)
  .join('\n')

const html = [
  '<!doctype html>',
  '<meta charset="utf-8">',
  '<title>Reading list</title>',
  `<h1>Reading list (${items.length})</h1>`,
  '<ul>',
  rows,
  '</ul>',
].join('\n')

await writeFile('reading-list.html', html)
console.log(`Wrote ${items.length} links to reading-list.html`)
```

**Python**

```python
import html
import os

import requests

BASE = "https://api.webbites.io/v1/api"
TAG = "reading"
HEADERS = {"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"}

# Everything under one tag, newest first.
items = []
before = None
while True:
    params = {"tag": TAG, "limit": 100}
    if before:
        params["before"] = before
    page = requests.get(f"{BASE}/bookmarks", params=params, headers=HEADERS, timeout=30).json()
    items.extend(page["bookmarks"])
    if not page.get("nextBefore") or len(page["bookmarks"]) < 100:
        break
    before = page["nextBefore"]

rows = "\n".join(
    f'  <li><a href="{html.escape(b["url"])}">{html.escape(b.get("title") or b["url"])}</a></li>'
    for b in items
)
page_html = f"""<!doctype html>
<meta charset="utf-8">
<title>Reading list</title>
<h1>Reading list ({len(items)})</h1>
<ul>
{rows}
</ul>"""

with open("reading-list.html", "w") as f:
    f.write(page_html)
print(f"Wrote {len(items)} links to reading-list.html")
```

## Mirror your GitHub stars

Every repository you star, saved and tagged automatically. Run it on a schedule; the tag makes the second run cheap to reconcile.

**JavaScript**

```javascript
const GITHUB_USER = 'elrumo'
const BASE = 'https://api.webbites.io/v1/api'
const headers = {
  Authorization: `Bearer ${process.env.WEBBITES_KEY}`,
  'Content-Type': 'application/json',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// What is already in the library, so a second run is not a second save.
const saved = new Set()
let before = null
while (true) {
  const params = new URLSearchParams({ tag: 'github', limit: '100' })
  if (before) params.set('before', before)
  const page = await fetch(`${BASE}/bookmarks?${params}`, { headers }).then(r => r.json())
  page.bookmarks.forEach(b => saved.add(b.url))
  if (!page.nextBefore || page.bookmarks.length < 100) break
  before = page.nextBefore
}

const stars = await fetch(
  `https://api.github.com/users/${GITHUB_USER}/starred?per_page=100`,
  { headers: { Accept: 'application/vnd.github+json' } },
).then(r => r.json())

for (const repo of stars) {
  if (saved.has(repo.html_url)) continue

  await fetch(`${BASE}/bookmarks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url: repo.html_url,
      tags: ['github', repo.language?.toLowerCase()].filter(Boolean),
      note: repo.description || undefined,
    }),
  })

  console.log('saved', repo.full_name)
  await sleep(1100) // stay inside the per-minute allowance
}
```

**Python**

```python
import os
import time

import requests

GITHUB_USER = "elrumo"
BASE = "https://api.webbites.io/v1/api"
HEADERS = {"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"}

# What is already in the library, so a second run is not a second save.
saved = set()
before = None
while True:
    params = {"tag": "github", "limit": 100}
    if before:
        params["before"] = before
    page = requests.get(f"{BASE}/bookmarks", params=params, headers=HEADERS, timeout=30).json()
    saved.update(b["url"] for b in page["bookmarks"])
    if not page.get("nextBefore") or len(page["bookmarks"]) < 100:
        break
    before = page["nextBefore"]

stars = requests.get(
    f"https://api.github.com/users/{GITHUB_USER}/starred",
    params={"per_page": 100},
    headers={"Accept": "application/vnd.github+json"},
    timeout=30,
).json()

for repo in stars:
    if repo["html_url"] in saved:
        continue
    tags = ["github"] + ([repo["language"].lower()] if repo.get("language") else [])
    requests.post(
        f"{BASE}/bookmarks",
        json={"url": repo["html_url"], "tags": tags, "note": repo.get("description") or None},
        headers=HEADERS,
        timeout=30,
    )
    print("saved", repo["full_name"])
    time.sleep(1.1)  # stay inside the per-minute allowance
```

## Sync into your notes

Write every new save into an Obsidian vault (or any folder) as a markdown note — front matter, summary and all — straight from the `bookmark.saved` webhook.

**JavaScript**

```javascript
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import express from 'express'

const VAULT = process.env.OBSIDIAN_VAULT || './notes'
const app = express()

// bookmark.saved fires once the screenshot, summary and tags are ready.
app.post('/webhooks/webbites', express.json(), async (req, res) => {
  res.sendStatus(200) // acknowledge inside a few seconds; write afterwards.

  const b = req.body?.data
  if (!b) return

  const note = [
    '---',
    `title: ${JSON.stringify(b.title || b.url)}`,
    `url: ${b.url}`,
    `tags: [${(b.tags || []).join(', ')}]`,
    `saved: ${b.createdAt}`,
    '---',
    '',
    b.summary || '',
    '',
    `[Open original](${b.url})`,
  ].join('\n')

  const slug = (b.title || b.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
  await mkdir(VAULT, { recursive: true })
  await writeFile(join(VAULT, `${slug}.md`), note)
  console.log('wrote', slug)
})

app.listen(3000)
```

**Python**

```python
import json
import os
import re

from flask import Flask, request

VAULT = os.environ.get("OBSIDIAN_VAULT", "./notes")
app = Flask(__name__)


@app.post("/webhooks/webbites")
def webbites():
    # bookmark.saved fires once the screenshot, summary and tags are ready.
    b = (request.json or {}).get("data")
    if not b:
        return "", 200

    note = "\n".join([
        "---",
        f"title: {json.dumps(b.get('title') or b['url'])}",
        f"url: {b['url']}",
        f"tags: [{', '.join(b.get('tags') or [])}]",
        f"saved: {b['createdAt']}",
        "---",
        "",
        b.get("summary") or "",
        "",
        f"[Open original]({b['url']})",
    ])

    slug = re.sub(r"[^a-z0-9]+", "-", (b.get("title") or b["id"]).lower())[:60]
    os.makedirs(VAULT, exist_ok=True)
    with open(os.path.join(VAULT, f"{slug}.md"), "w") as f:
        f.write(note)
    return "", 200


app.run(port=3000)
```

Verify the [webhook signature](https://www.webbites.io/developers/docs/webhooks) before you write anything to disk — the delivery id in `X-WebBites-Delivery` also lets you skip retries you have already handled.

## Nightly backups

Walks every page with the cursor and writes one JSON file. Useful as a cron job, and the shortest possible demonstration of pagination.

**JavaScript**

```javascript
import { writeFile } from 'node:fs/promises'

const BASE = 'https://api.webbites.io/v1/api'
const headers = { Authorization: `Bearer ${process.env.WEBBITES_KEY}` }
const PAGE = 100

const all = []
let before = null

while (true) {
  const params = new URLSearchParams({ limit: String(PAGE) })
  if (before) params.set('before', before)

  const res = await fetch(`${BASE}/bookmarks?${params}`, { headers })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)

  const page = await res.json()
  all.push(...page.bookmarks)
  process.stdout.write(`\r${all.length} bookmarks…`)

  if (!page.nextBefore || page.bookmarks.length < PAGE) break
  before = page.nextBefore
}

const name = `webbites-${new Date().toISOString().slice(0, 10)}.json`
await writeFile(name, JSON.stringify(all, null, 2))
console.log(`\nWrote ${all.length} bookmarks to ${name}`)
```

**Python**

```python
import json
import os
from datetime import date

import requests

BASE = "https://api.webbites.io/v1/api"
HEADERS = {"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"}
PAGE = 100

bookmarks = []
before = None

while True:
    params = {"limit": PAGE}
    if before:
        params["before"] = before

    res = requests.get(f"{BASE}/bookmarks", params=params, headers=HEADERS, timeout=30)
    res.raise_for_status()
    page = res.json()

    bookmarks.extend(page["bookmarks"])
    print(f"\r{len(bookmarks)} bookmarks…", end="", flush=True)

    if not page.get("nextBefore") or len(page["bookmarks"]) < PAGE:
        break
    before = page["nextBefore"]

name = f"webbites-{date.today()}.json"
with open(name, "w") as f:
    json.dump(bookmarks, f, indent=2)
print(f"\nWrote {len(bookmarks)} bookmarks to {name}")
```

> Want a backup without writing code? Settings → Export gives you the same thing on any plan.

## Build something else?

A Raycast or Alfred command, an RSS reader that files what you finish, a Discord bot, a research folder that fills itself — they are all the same two calls. If you make something, [tell us about it](https://www.webbites.io/feedback); if you get stuck, the [playground](https://www.webbites.io/developers/docs/playground) is the fastest way to see what an endpoint really returns.
