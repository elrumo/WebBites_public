<template>
  <section>
    <h2 id="the-allowances">The allowances</h2>
    <p>
      Two limits apply at once: a burst limit per minute, and a total per calendar month. Both follow the
      plan the account is on, and both are shared by every key on it.
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Plan</th><th>Requests per minute</th><th>Requests per month</th></tr></thead>
        <tbody>
          <tr v-for="row in RATE_LIMITS" :key="row.plan">
            <td class="capitalize">{{ row.plan }}</td>
            <td>{{ row.perMinute.toLocaleString() }}</td>
            <td>{{ row.perMonth.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Your own numbers, and what you have spent against them, are on
      <NuxtLink to="/developers/docs/usage">the usage page</NuxtLink> and in
      <code>GET /usage</code>.
    </p>
  </section>

  <section>
    <h2 id="the-headers">The headers</h2>
    <p>Every response tells you where you stand, so you never have to guess:</p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Header</th><th>What it says</th></tr></thead>
        <tbody>
          <tr v-for="h in RATE_LIMIT_HEADERS" :key="h.name">
            <td><code>{{ h.name }}</code></td>
            <td>{{ h.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <DevCode :code="READ_HEADERS" language="javascript" label="Reading them" />
  </section>

  <section>
    <h2 id="over-the-limit">Over the limit</h2>
    <p>
      Past either allowance you get a <code>429</code>. Wait for <code>Retry-After</code> and send the
      request again — nothing is lost, and the per-minute window clears in under a minute. A monthly
      allowance, on the other hand, only clears on the first of the month or when you change plan.
    </p>
    <DevCode :code="BACKOFF" language="bash" label="Terminal" />
  </section>

  <section>
    <h2 id="staying-under">Staying under it</h2>
    <ul>
      <li><strong>Use webhooks instead of polling.</strong> One delivery costs you nothing; checking a bookmark every three seconds costs twenty requests a minute.</li>
      <li><strong>Ask for bigger pages.</strong> <code>limit=100</code> walks a library in a fifth of the requests <code>limit=20</code> needs.</li>
      <li><strong>Cache what does not change.</strong> An old bookmark's title will be the same tomorrow.</li>
      <li><strong>Pace bulk work.</strong> A sleep between saves is the difference between finishing and being throttled — the <NuxtLink to="/developers/docs/saving-bookmarks">import loop</NuxtLink> shows the shape.</li>
      <li><strong>Watch <code>X-RateLimit-Remaining</code>.</strong> Slow down as it approaches zero rather than after you hit it.</li>
    </ul>
  </section>
</template>

<script setup>
import { API_BASE_URL, RATE_LIMITS, RATE_LIMIT_HEADERS } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const READ_HEADERS = `const res = await fetch(\`\${BASE}/bookmarks\`, { headers })

const remaining = Number(res.headers.get('x-ratelimit-remaining'))
const resetsAt = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000)

if (remaining < 10) {
  console.warn(\`\${remaining} requests left until \${resetsAt.toLocaleTimeString()}\`)
}`

const BACKOFF = `curl -i ${API_BASE_URL}/bookmarks -H "Authorization: Bearer $WEBBITES_KEY"

HTTP/1.1 429 Too Many Requests
Retry-After: 27
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0`
</script>
