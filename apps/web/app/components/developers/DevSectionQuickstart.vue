<template>
  <section>
    <h2 id="create-a-key">1. Create a key</h2>
    <p>
      Keys live on your account. Make one here — it works the moment it appears, and you can revoke it
      just as fast.
    </p>
    <DevApiKeysPanel />
    <p>
      Keep it out of your shell history and out of any repository. Everything below assumes it is in an
      environment variable:
    </p>
    <DevCode :code="EXPORT_KEY" language="bash" label="Terminal" />
  </section>

  <section>
    <h2 id="first-call">2. Make your first call</h2>
    <p>
      <code>GET /bookmarks</code> returns your most recent saves. If this answers with JSON, everything
      else on this site will work too.
    </p>
    <DevCode :tabs="LIST_TABS" />
    <p>You get back an array and a cursor:</p>
    <DevCode :code="LIST_RESPONSE" language="json" label="Response" />
  </section>

  <section>
    <h2 id="save-something">3. Save something</h2>
    <p>
      <code>POST /bookmarks</code> needs a <code>url</code> and takes optional <code>tags</code> and a
      <code>note</code>. It answers immediately, before the page has been fetched.
    </p>
    <DevCode :tabs="SAVE_TABS" />
    <DevCode :code="SAVE_RESPONSE" language="json" label="Response" />
    <div class="docs-note">
      <code>"status": "processing"</code> means the screenshot, summary and automatic tags are still
      being generated. Read
      <NuxtLink to="/developers/docs/saving-bookmarks">Saving bookmarks</NuxtLink> for the two ways to
      find out when they land.
    </div>
  </section>

  <section>
    <h2 id="next">4. Where to go next</h2>
    <ul>
      <li><NuxtLink to="/developers/docs/searching">Searching &amp; paging</NuxtLink> — filters, full-text search and walking the whole library.</li>
      <li><NuxtLink to="/developers/docs/webhooks">Webhooks</NuxtLink> — get pushed the finished bookmark instead of polling for it.</li>
      <li><NuxtLink to="/developers/docs/recipes">Recipes</NuxtLink> — a backup script, a Slack command and a digest you can copy whole.</li>
      <li><NuxtLink to="/developers/docs/playground">Playground</NuxtLink> — try any endpoint from the browser.</li>
    </ul>
  </section>
</template>

<script setup>
import { API_BASE_URL } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'
import DevApiKeysPanel from '~/components/developers/DevApiKeysPanel.vue'

const EXPORT_KEY = `export WEBBITES_KEY="wb_live_…"`

const LIST_TABS = [
  {
    label: 'cURL',
    language: 'bash',
    code: `curl ${API_BASE_URL}/bookmarks?limit=5 \\
  -H "Authorization: Bearer $WEBBITES_KEY"`,
  },
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `const res = await fetch('${API_BASE_URL}/bookmarks?limit=5', {
  headers: { Authorization: \`Bearer \${process.env.WEBBITES_KEY}\` },
})

const { bookmarks } = await res.json()
console.log(bookmarks.map(b => b.title))`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os, requests

res = requests.get(
    "${API_BASE_URL}/bookmarks",
    params={"limit": 5},
    headers={"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"},
    timeout=30,
)
res.raise_for_status()

for bookmark in res.json()["bookmarks"]:
    print(bookmark["title"])`,
  },
]

const LIST_RESPONSE = `{
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
}`

const SAVE_TABS = [
  {
    label: 'cURL',
    language: 'bash',
    code: `curl -X POST ${API_BASE_URL}/bookmarks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://nuxt.com","tags":["reading","vue"],"note":"For the docs rewrite"}'`,
  },
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `const res = await fetch('${API_BASE_URL}/bookmarks', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.WEBBITES_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://nuxt.com',
    tags: ['reading', 'vue'],
    note: 'For the docs rewrite',
  }),
})

const bookmark = await res.json()
console.log(bookmark.id, bookmark.status)`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os, requests

res = requests.post(
    "${API_BASE_URL}/bookmarks",
    json={"url": "https://nuxt.com", "tags": ["reading", "vue"], "note": "For the docs rewrite"},
    headers={"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"},
    timeout=30,
)
res.raise_for_status()
print(res.json()["id"])`,
  },
]

const SAVE_RESPONSE = `{
  "id": "abc123",
  "url": "https://nuxt.com",
  "status": "processing"
}`
</script>
