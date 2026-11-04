<template>
  <section>
    <p class="docs-lead">
      Six small programs, one for every idea on the
      <NuxtLink to="/developers">developers page</NuxtLink>. Each is complete — set
      <code>WEBBITES_KEY</code> and run it. Every snippet comes in JavaScript and Python; switch with
      the tabs above the code.
    </p>

    <!-- Jump grid: click an idea to scroll to its recipe. -->
    <div class="recipe-index">
      <a
        v-for="r in RECIPE_INDEX"
        :key="r.anchor"
        :href="`#${r.anchor}`"
        class="recipe-chip"
        @click.prevent="goTo(r.anchor)"
      >
        <span class="recipe-chip-emoji" aria-hidden="true">{{ r.emoji }}</span>
        <span class="recipe-chip-title">{{ r.title }}</span>
        <span class="recipe-chip-code">{{ r.uses }}</span>
      </a>
    </div>
  </section>

  <section>
    <h2 id="slack">A Slack “/save” command</h2>
    <p>
      Type <code>/save https://example.com tag:reading</code> in Slack and it lands in your library.
      Slack wants a reply within three seconds, so answer first and save afterwards.
    </p>
    <DevCode :tabs="pair(SLACK_JS, SLACK_PY)" />
    <p>
      In production, verify Slack's own <code>X-Slack-Signature</code> header before you act on a
      request — the same idea as verifying
      <NuxtLink to="/developers/docs/webhooks">our webhook signature</NuxtLink>, with Slack's secret.
    </p>
  </section>

  <section>
    <h2 id="digest">A weekly digest</h2>
    <p>
      What did you save this week? This groups the last seven days by tag and prints markdown you can
      paste into a newsletter, a standup note or an email.
    </p>
    <DevCode :tabs="pair(DIGEST_JS, DIGEST_PY)" />
  </section>

  <section>
    <h2 id="reading-list">A public reading list</h2>
    <p>
      Everything under one tag, turned into a static HTML page you can host anywhere. New save, new
      entry, no CMS — run it whenever the tag changes, or on a schedule.
    </p>
    <DevCode :tabs="pair(READING_JS, READING_PY)" />
  </section>

  <section>
    <h2 id="github-stars">Mirror your GitHub stars</h2>
    <p>
      Every repository you star, saved and tagged automatically. Run it on a schedule; the tag makes the
      second run cheap to reconcile.
    </p>
    <DevCode :tabs="pair(STARS_JS, STARS_PY)" />
  </section>

  <section>
    <h2 id="notes-sync">Sync into your notes</h2>
    <p>
      Write every new save into an Obsidian vault (or any folder) as a markdown note — front matter,
      summary and all — straight from the <code>bookmark.saved</code> webhook.
    </p>
    <DevCode :tabs="pair(NOTES_JS, NOTES_PY)" />
    <p>
      Verify the <NuxtLink to="/developers/docs/webhooks">webhook signature</NuxtLink> before you write
      anything to disk — the delivery id in <code>X-WebBites-Delivery</code> also lets you skip retries
      you have already handled.
    </p>
  </section>

  <section>
    <h2 id="backup">Nightly backups</h2>
    <p>
      Walks every page with the cursor and writes one JSON file. Useful as a cron job, and the shortest
      possible demonstration of pagination.
    </p>
    <DevCode :tabs="pair(BACKUP_JS, BACKUP_PY)" />
    <div class="docs-note">
      Want a backup without writing code? Settings → Export gives you the same thing on any plan.
    </div>
  </section>

  <section>
    <h2 id="more">Build something else?</h2>
    <p>
      A Raycast or Alfred command, an RSS reader that files what you finish, a Discord bot, a
      research folder that fills itself — they are all the same two calls. If you make something,
      <NuxtLink to="/feedback">tell us about it</NuxtLink>; if you get stuck, the
      <NuxtLink to="/developers/docs/playground">playground</NuxtLink> is the fastest way to see what an
      endpoint really returns.
    </p>
  </section>
</template>

<script setup>
import { API_BASE_URL } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const RECIPE_INDEX = [
  { emoji: '💬', title: 'A Slack “/save” command', anchor: 'slack', uses: 'POST /bookmarks' },
  { emoji: '📬', title: 'A weekly digest', anchor: 'digest', uses: 'GET /bookmarks' },
  { emoji: '🗂️', title: 'A public reading list', anchor: 'reading-list', uses: 'GET /bookmarks?tag=' },
  { emoji: '⭐', title: 'Mirror your GitHub stars', anchor: 'github-stars', uses: 'POST /bookmarks' },
  { emoji: '🧠', title: 'Sync into your notes', anchor: 'notes-sync', uses: 'bookmark.saved' },
  { emoji: '💾', title: 'Nightly backups', anchor: 'backup', uses: 'GET /bookmarks' },
]

// Same smooth jump the table of contents uses.
const goTo = (id) => {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  history.replaceState(null, '', `#${id}`)
}

/** [{ JavaScript }, { Python }] — the language switch on every recipe. */
const pair = (js, py) => [
  { label: 'JavaScript', language: 'javascript', code: js },
  { label: 'Python', language: 'python', code: py },
]

// ── Slack /save ──────────────────────────────────────────────────────────
const SLACK_JS = `import express from 'express'

const app = express()
const BASE = '${API_BASE_URL}'

app.post('/slack/save', express.urlencoded({ extended: true }), async (req, res) => {
  // Slack sends the whole command line as one string: "https://… tag:reading"
  const words = (req.body.text || '').trim().split(/\\s+/)
  const url = words.find(w => w.startsWith('http'))
  const tags = words.filter(w => w.startsWith('tag:')).map(w => w.slice(4))

  if (!url) return res.json({ text: 'Give me a URL to save.' })

  // Answer inside Slack's three second window, then do the work.
  res.json({ response_type: 'in_channel', text: \`Saving \${url}…\` })

  const saved = await fetch(\`\${BASE}/bookmarks\`, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${process.env.WEBBITES_KEY}\`,
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
      text: saved.id ? \`Saved — it will finish processing in a moment.\` : 'That did not save.',
    }),
  })
})

app.listen(3000)`

const SLACK_PY = `import os
import threading

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)
BASE = "${API_BASE_URL}"


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
    return jsonify(response_type="in_channel", text=f"Saving {url}…")`

// ── Weekly digest ────────────────────────────────────────────────────────
const DIGEST_JS = `const BASE = '${API_BASE_URL}'
const headers = { Authorization: \`Bearer \${process.env.WEBBITES_KEY}\` }
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

const byTag = new Map()
let before = null
let done = false

while (!done) {
  const params = new URLSearchParams({ limit: '100' })
  if (before) params.set('before', before)

  const page = await fetch(\`\${BASE}/bookmarks?\${params}\`, { headers }).then(r => r.json())

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

console.log(\`# Saved since \${since.toISOString().slice(0, 10)}\\n\`)
for (const [tag, items] of [...byTag].sort((a, b) => b[1].length - a[1].length)) {
  console.log(\`## \${tag} (\${items.length})\`)
  for (const b of items) console.log(\`- [\${b.title}](\${b.url})\`)
  console.log()
}`

const DIGEST_PY = `import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

BASE = "${API_BASE_URL}"
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

print(f"# Saved since {SINCE:%d %b}\\n")
for tag, items in sorted(by_tag.items(), key=lambda kv: -len(kv[1])):
    print(f"## {tag} ({len(items)})")
    for bookmark in items:
        print(f"- [{bookmark['title']}]({bookmark['url']})")
    print()`

// ── Public reading list ──────────────────────────────────────────────────
const READING_JS = `import { writeFile } from 'node:fs/promises'

const BASE = '${API_BASE_URL}'
const TAG = 'reading'
const headers = { Authorization: \`Bearer \${process.env.WEBBITES_KEY}\` }

// Everything under one tag, newest first.
const items = []
let before = null
while (true) {
  const params = new URLSearchParams({ tag: TAG, limit: '100' })
  if (before) params.set('before', before)
  const page = await fetch(\`\${BASE}/bookmarks?\${params}\`, { headers }).then(r => r.json())
  items.push(...page.bookmarks)
  if (!page.nextBefore || page.bookmarks.length < 100) break
  before = page.nextBefore
}

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const rows = items
  .map(b => \`  <li><a href="\${esc(b.url)}">\${esc(b.title || b.url)}</a></li>\`)
  .join('\\n')

const html = [
  '<!doctype html>',
  '<meta charset="utf-8">',
  '<title>Reading list</title>',
  \`<h1>Reading list (\${items.length})</h1>\`,
  '<ul>',
  rows,
  '</ul>',
].join('\\n')

await writeFile('reading-list.html', html)
console.log(\`Wrote \${items.length} links to reading-list.html\`)`

const READING_PY = `import html
import os

import requests

BASE = "${API_BASE_URL}"
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

rows = "\\n".join(
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
print(f"Wrote {len(items)} links to reading-list.html")`

// ── GitHub stars ─────────────────────────────────────────────────────────
const STARS_JS = `const GITHUB_USER = 'elrumo'
const BASE = '${API_BASE_URL}'
const headers = {
  Authorization: \`Bearer \${process.env.WEBBITES_KEY}\`,
  'Content-Type': 'application/json',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// What is already in the library, so a second run is not a second save.
const saved = new Set()
let before = null
while (true) {
  const params = new URLSearchParams({ tag: 'github', limit: '100' })
  if (before) params.set('before', before)
  const page = await fetch(\`\${BASE}/bookmarks?\${params}\`, { headers }).then(r => r.json())
  page.bookmarks.forEach(b => saved.add(b.url))
  if (!page.nextBefore || page.bookmarks.length < 100) break
  before = page.nextBefore
}

const stars = await fetch(
  \`https://api.github.com/users/\${GITHUB_USER}/starred?per_page=100\`,
  { headers: { Accept: 'application/vnd.github+json' } },
).then(r => r.json())

for (const repo of stars) {
  if (saved.has(repo.html_url)) continue

  await fetch(\`\${BASE}/bookmarks\`, {
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
}`

const STARS_PY = `import os
import time

import requests

GITHUB_USER = "elrumo"
BASE = "${API_BASE_URL}"
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
    time.sleep(1.1)  # stay inside the per-minute allowance`

// ── Sync into notes (webhook → markdown) ─────────────────────────────────
const NOTES_JS = `import { writeFile, mkdir } from 'node:fs/promises'
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
    \`title: \${JSON.stringify(b.title || b.url)}\`,
    \`url: \${b.url}\`,
    \`tags: [\${(b.tags || []).join(', ')}]\`,
    \`saved: \${b.createdAt}\`,
    '---',
    '',
    b.summary || '',
    '',
    \`[Open original](\${b.url})\`,
  ].join('\\n')

  const slug = (b.title || b.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
  await mkdir(VAULT, { recursive: true })
  await writeFile(join(VAULT, \`\${slug}.md\`), note)
  console.log('wrote', slug)
})

app.listen(3000)`

const NOTES_PY = `import json
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

    note = "\\n".join([
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


app.run(port=3000)`

// ── Nightly backup ───────────────────────────────────────────────────────
const BACKUP_JS = `import { writeFile } from 'node:fs/promises'

const BASE = '${API_BASE_URL}'
const headers = { Authorization: \`Bearer \${process.env.WEBBITES_KEY}\` }
const PAGE = 100

const all = []
let before = null

while (true) {
  const params = new URLSearchParams({ limit: String(PAGE) })
  if (before) params.set('before', before)

  const res = await fetch(\`\${BASE}/bookmarks?\${params}\`, { headers })
  if (!res.ok) throw new Error(\`\${res.status} \${await res.text()}\`)

  const page = await res.json()
  all.push(...page.bookmarks)
  process.stdout.write(\`\\r\${all.length} bookmarks…\`)

  if (!page.nextBefore || page.bookmarks.length < PAGE) break
  before = page.nextBefore
}

const name = \`webbites-\${new Date().toISOString().slice(0, 10)}.json\`
await writeFile(name, JSON.stringify(all, null, 2))
console.log(\`\\nWrote \${all.length} bookmarks to \${name}\`)`

const BACKUP_PY = `import json
import os
from datetime import date

import requests

BASE = "${API_BASE_URL}"
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
    print(f"\\r{len(bookmarks)} bookmarks…", end="", flush=True)

    if not page.get("nextBefore") or len(page["bookmarks"]) < PAGE:
        break
    before = page["nextBefore"]

name = f"webbites-{date.today()}.json"
with open(name, "w") as f:
    json.dump(bookmarks, f, indent=2)
print(f"\\nWrote {len(bookmarks)} bookmarks to {name}")`
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.recipe-index { @apply grid grid-cols-2 gap-3 sm:grid-cols-3; }

.recipe-chip {
  @apply flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-4 no-underline transition duration-300;
  @apply hover:-translate-y-0.5 hover:border-green-400/40 hover:bg-white/[0.06];
}
.recipe-chip-emoji { @apply text-2xl leading-none; }
.recipe-chip-title { @apply text-sm font-semibold text-white; }
.recipe-chip-code { @apply mt-auto pt-1 font-mono text-[11px] text-neutral-500; }

@media (prefers-reduced-motion: reduce) {
  .recipe-chip { transition: none; }
  .recipe-chip:hover { transform: none; }
}
</style>
