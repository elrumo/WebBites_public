<template>
  <section>
    <h2 id="this-month">This month</h2>
    <p>
      Your plan, what it allows and what you have spent against it — the same numbers the API returns,
      broken down by key.
    </p>
    <DevUsagePanel />
  </section>

  <section>
    <h2 id="from-code">Checking usage from code</h2>
    <p>
      <code>GET /usage</code> returns all of it. Worth calling at the start of a long job: if the month's
      allowance cannot cover the work, you would rather know before you start than half way through.
    </p>
    <DevCode :code="USAGE_CALL" language="bash" label="Request" />
    <DevCode :code="USAGE_RESPONSE" language="json" label="Response" />
    <DevCode :code="BUDGET" language="javascript" label="budget.js" />
  </section>

  <section>
    <h2 id="what-counts">What counts</h2>
    <ul>
      <li><strong>Requests you make against the API</strong> are what the allowance covers — every call in this list of endpoints, however small.</li>
      <li><strong>Deliveries we send you</strong> are ours to make, not requests you made, which is the main reason to prefer a webhook over polling.</li>
      <li><strong>Using the app, the extension or the native apps</strong> is not API traffic and does not appear here.</li>
      <li><strong>Limits are per account</strong>, shared across every key. <code>byKey</code> tells you which key spent what.</li>
      <li><strong>Tool calls from AI assistants</strong> count too, one request per call. An assistant connected by signing in is counted per connection in <code>byGrant</code>; one using an API key counts against that key. See <NuxtLink to="/developers/docs/mcp">MCP server</NuxtLink>.</li>
    </ul>
    <p>
      Running out of month rather than out of minute? The plans are on the
      <NuxtLink to="/#pricing">pricing section</NuxtLink>, and
      <NuxtLink to="/developers/docs/rate-limits">Rate limits</NuxtLink> lists what each one allows.
    </p>
  </section>
</template>

<script setup>
import { API_BASE_URL } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'
import DevUsagePanel from '~/components/developers/DevUsagePanel.vue'

const USAGE_CALL = `curl ${API_BASE_URL}/usage \\
  -H "Authorization: Bearer $WEBBITES_KEY"`

const USAGE_RESPONSE = `{
  "tier": "plus",
  "limits": { "perMinute": 300, "perMonth": 20000 },
  "usage": {
    "month": "2026-10",
    "total": 412,
    "byKey": { "wb_live_…": 400 },
    "byGrant": { "Xq3kR8pLmZ": 12 }
  }
}`

const BUDGET = `const usage = await fetch(\`\${BASE}/usage\`, { headers }).then(r => r.json())

const left = usage.limits.perMonth - usage.usage.total
if (left < urls.length) {
  throw new Error(\`Need \${urls.length} requests, \${left} left this month.\`)
}`
</script>
