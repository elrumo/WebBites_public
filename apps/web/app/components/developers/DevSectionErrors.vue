<template>
  <section>
    <h2 id="status-codes">Status codes</h2>
    <p>
      The HTTP status is the part to branch on. Anything in the <code>2xx</code> range worked; everything
      else comes back with a body describing what went wrong.
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Status</th><th>Meaning</th><th>What to do</th></tr></thead>
        <tbody>
          <tr v-for="e in ERROR_STATUSES" :key="e.status">
            <td><code>{{ e.status }}</code></td>
            <td>{{ e.title }}</td>
            <td>{{ e.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2 id="in-code">Handling them in code</h2>
    <p>
      <code>fetch</code> only rejects on a network failure, so a <code>401</code> looks like a success
      until you check <code>res.ok</code>. Check it on every call, and keep the response body — it is the
      part that says which field was wrong.
    </p>
    <DevCode :code="WRAPPER" language="javascript" label="webbites.js" />
  </section>

  <section>
    <h2 id="retrying">Retrying safely</h2>
    <p>
      Retry <code>429</code> and <code>5xx</code>; don't retry <code>400</code>, <code>401</code>,
      <code>403</code> or <code>404</code>, because the same request will fail the same way. For a
      <code>429</code>, wait the number of seconds in <code>Retry-After</code> rather than guessing.
    </p>
    <DevCode :code="RETRY" language="javascript" label="retry.js" />
    <div class="docs-note warn">
      <code>POST /bookmarks</code> is not idempotent: a retry after a request that actually succeeded
      leaves you with the same page saved twice. Retry a save only when you never saw a response, and
      de-duplicate on <code>url</code> if it matters to you.
    </div>
  </section>

  <section>
    <h2 id="when-something-is-off">When the answer looks wrong</h2>
    <ul>
      <li><strong>A bookmark came back thin</strong> — no summary, no screenshot. It is probably still processing; read it again in a few seconds. See <NuxtLink to="/developers/docs/saving-bookmarks">Saving bookmarks</NuxtLink>.</li>
      <li><strong>It stays thin.</strong> Some sites block automated fetching or sit behind a login, and we save what we can reach. Editing the bookmark in the app fixes it for good.</li>
      <li><strong>401 with a key you just made.</strong> Check the header is <code>Authorization: Bearer wb_live_…</code> and that nothing trimmed the prefix — a shell variable that was never exported is the usual culprit.</li>
      <li><strong>Everything 429s.</strong> Look at <code>X-RateLimit-Remaining</code> on any response and at <NuxtLink to="/developers/docs/usage">your usage</NuxtLink>: a monthly allowance that has run out looks exactly like a burst that was too fast.</li>
    </ul>
    <p>
      Still stuck? <NuxtLink to="/support">Tell us what you sent and what came back</NuxtLink> — the
      request, the status and the body are enough to find it.
    </p>
  </section>
</template>

<script setup>
import { API_BASE_URL, ERROR_STATUSES } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const WRAPPER = `const BASE = '${API_BASE_URL}'

export class WebBitesError extends Error {
  constructor(status, body) {
    super(\`WebBites API \${status}: \${body}\`)
    this.status = status
    this.body = body
  }
}

export async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: \`Bearer \${process.env.WEBBITES_KEY}\`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (!res.ok) throw new WebBitesError(res.status, await res.text())
  return res.status === 204 ? null : res.json()
}`

const RETRY = `const RETRYABLE = new Set([429, 500, 502, 503, 504])
const sleep = ms => new Promise(r => setTimeout(r, ms))

const authed = (options = {}) => ({
  ...options,
  headers: {
    Authorization: \`Bearer \${process.env.WEBBITES_KEY}\`,
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
}`
</script>
