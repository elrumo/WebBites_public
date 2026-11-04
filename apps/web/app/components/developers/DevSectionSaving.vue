<template>
  <section>
    <h2 id="save-a-url">Save a URL</h2>
    <p>
      One required field, two optional ones. <code>tags</code> is a comma separated list, and
      <code>note</code> is free text that stays yours — nothing overwrites it later.
    </p>
    <DevCode :code="SAVE" language="bash" label="Request" />
    <DevCode :code="SAVE_RESPONSE" language="json" label="Response" />
  </section>

  <section>
    <h2 id="what-happens-next">What happens next</h2>
    <p>
      The response comes back before the page has been fetched, so the bookmark you get is a stub. In the
      background we then fetch the page and fill in:
    </p>
    <ul>
      <li><strong>title and description</strong> from the page's own metadata;</li>
      <li><strong>image, favicon and a full-page screenshot</strong>;</li>
      <li><strong>a summary</strong> of what the page says;</li>
      <li><strong>automatic tags</strong>, added to the ones you passed;</li>
      <li><strong>type</strong> — <code>website</code>, <code>article</code>, <code>image</code> and friends.</li>
    </ul>
    <p>
      How long it takes depends on the page. Most finish in seconds; a slow or heavy site takes longer.
      Sites that block automated fetching, or sit behind a login or a paywall, come back with whatever we
      could reach — the bookmark is still saved, just thinner.
    </p>
  </section>

  <section>
    <h2 id="waiting-for-it">Waiting for the finished version</h2>
    <h3>The good way: a webhook</h3>
    <p>
      Register an endpoint once and we POST the finished bookmark to it, no polling and no wasted quota.
      This is what the <NuxtLink to="/developers/docs/webhooks">webhooks guide</NuxtLink> is for.
    </p>

    <h3>The simple way: poll the bookmark</h3>
    <p>
      For a one-off script, re-reading <code>GET /bookmarks/:id</code> until <code>summary</code> fills in
      is fine. Space the checks out — every request counts against your
      <NuxtLink to="/developers/docs/rate-limits">rate limit</NuxtLink>.
    </p>
    <DevCode :code="POLL" language="javascript" label="poll.js" />
  </section>

  <section>
    <h2 id="bulk-imports">Saving a lot at once</h2>
    <p>
      There is no batch endpoint: a bulk import is a loop over <code>POST /bookmarks</code>. Keep it
      sequential, or at most two or three at a time, and let the per-minute allowance set the pace. A
      script that fires a thousand requests at once gets <code>429</code>s and finishes later than one
      that paces itself.
    </p>
    <DevCode :code="BULK" language="javascript" label="import.js" />
    <div class="docs-note">
      Importing browser bookmarks rather than a list of URLs? The app's
      <NuxtLink to="/export-bookmarks">import guide</NuxtLink> does it in a few clicks, without any code.
    </div>
  </section>
</template>

<script setup>
import { API_BASE_URL } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const SAVE = `curl -X POST ${API_BASE_URL}/bookmarks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com","tags":["research","ai"],"note":"Cited in the Q3 deck"}'`

const SAVE_RESPONSE = `{
  "id": "abc123",
  "url": "https://example.com",
  "status": "processing"
}`

const POLL = `const KEY = process.env.WEBBITES_KEY
const headers = { Authorization: \`Bearer \${KEY}\` }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function saveAndWait(url, { attempts = 10, every = 3000 } = {}) {
  const created = await fetch('${API_BASE_URL}/bookmarks', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).then(r => r.json())

  for (let i = 0; i < attempts; i++) {
    await sleep(every)
    const bookmark = await fetch(\`${API_BASE_URL}/bookmarks/\${created.id}\`, { headers })
      .then(r => r.json())
    // The summary is the last thing to land, so it is the signal to stop.
    if (bookmark.summary) return bookmark
  }

  // Still processing. It will finish; this script just stopped waiting.
  return created
}`

const BULK = `const urls = ['https://a.example', 'https://b.example' /* … */]
const headers = {
  Authorization: \`Bearer \${process.env.WEBBITES_KEY}\`,
  'Content-Type': 'application/json',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const save = url => fetch('${API_BASE_URL}/bookmarks', {
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
}`
</script>
