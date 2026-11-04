<template>
  <section>
    <h2 id="what-they-are">What they are for</h2>
    <p>
      Saving is asynchronous, so something has to tell you when a bookmark is finished. A webhook is that
      something: register an HTTPS endpoint and we POST the whole enriched bookmark to it as soon as the
      screenshot, summary and tags are in. No polling, no wasted quota.
    </p>
    <p>There is one event today:</p>
    <ul>
      <li><code>bookmark.saved</code> — a bookmark finished processing. It fires for saves made from the API, the app and the extension alike.</li>
    </ul>
  </section>

  <section>
    <h2 id="register">Register an endpoint</h2>
    <p>
      Add one here, or with <code>POST /webhooks</code>. Either way the response carries the signing
      secret — copy it once and keep it with your other secrets.
    </p>
    <DevWebhooksPanel />
    <DevCode :code="REGISTER" language="bash" label="Request" />
    <DevCode :code="REGISTER_RESPONSE" language="json" label="Response" />
  </section>

  <section>
    <h2 id="the-payload">The delivery</h2>
    <p>Each delivery is a JSON POST with the event name, a delivery id and the bookmark itself:</p>
    <DevCode :code="WEBHOOK_PAYLOAD" language="json" label="Body" />
    <p>And these headers:</p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Header</th><th>What it carries</th></tr></thead>
        <tbody>
          <tr v-for="h in WEBHOOK_HEADERS" :key="h.name">
            <td><code>{{ h.name }}</code></td>
            <td>{{ h.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Answer <code>2xx</code> quickly. Do the real work after you have replied — a handler that keeps the
      connection open while it thinks looks like a broken endpoint.
    </p>
  </section>

  <section>
    <h2 id="verify">Verify the signature</h2>
    <p>
      <code>X-WebBites-Signature</code> is an HMAC-SHA256 of the <strong>raw</strong> request body, keyed
      with your webhook's secret. Verify it before you trust a delivery — anyone can POST to a public URL.
    </p>
    <DevCode :tabs="VERIFY_TABS" />
    <div class="docs-note warn">
      Sign the bytes you received, not a re-serialised object. <code>JSON.stringify(req.body)</code>
      reorders keys and drops whitespace, and the signature stops matching. In Express that means
      <code>express.raw()</code> on the webhook route.
    </div>
  </section>

  <section>
    <h2 id="a-receiver">A receiver, end to end</h2>
    <p>Express, raw body, signature check, fast reply:</p>
    <DevCode :code="RECEIVER" language="javascript" label="server.js" />
  </section>

  <section>
    <h2 id="retries">Retries and duplicates</h2>
    <p>
      A delivery that fails is retried, so your handler must be safe to run twice with the same payload.
      <code>X-WebBites-Delivery</code> is unique per delivery and stable across retries of it — keep the
      last few thousand ids and drop anything you have already seen.
    </p>
    <p>
      Repeated failures are counted per webhook, and the panel above shows the count, the last status your
      endpoint answered with and when it last heard from us. The <strong>Test</strong> button sends a
      sample delivery on demand, which is the fastest way to check a new receiver — including against a
      tunnel while you are still developing it.
    </p>
  </section>
</template>

<script setup>
import {
  API_BASE_URL, WEBHOOK_PAYLOAD, WEBHOOK_HEADERS, SIGNATURE_SNIPPET,
} from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'
import DevWebhooksPanel from '~/components/developers/DevWebhooksPanel.vue'

const REGISTER = `curl -X POST ${API_BASE_URL}/webhooks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/webhooks/webbites","description":"digest builder"}'`

const REGISTER_RESPONSE = `{
  "id": "wh_1",
  "url": "https://example.com/webhooks/webbites",
  "events": ["bookmark.saved"],
  "active": true,
  "secret": "whsec_…"
}`

const VERIFY_TABS = [
  { label: 'Node', language: 'javascript', code: SIGNATURE_SNIPPET },
  {
    label: 'Python',
    language: 'python',
    code: `import hashlib
import hmac


def verify(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """raw_body must be the untouched request body, not a re-serialised dict."""
    expected = "sha256=" + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)`,
  },
]

const RECEIVER = `import express from 'express'
import crypto from 'node:crypto'

const app = express()
const SECRET = process.env.WEBBITES_WEBHOOK_SECRET
const seen = new Set() // swap for Redis or a table once this matters

// express.raw keeps the exact bytes we signed.
app.post('/webhooks/webbites', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.get('X-WebBites-Signature') || ''
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(req.body).digest('hex')

  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return res.status(401).end()
  }

  const delivery = req.get('X-WebBites-Delivery')
  if (seen.has(delivery)) return res.status(200).end() // a retry of something we handled
  seen.add(delivery)

  const { event, data } = JSON.parse(req.body.toString('utf8'))

  // Reply first, work afterwards.
  res.status(200).end()

  if (event === 'bookmark.saved') {
    queue.add(() => index(data)) // your job queue, your indexing
  }
})

app.listen(3000)`
</script>
