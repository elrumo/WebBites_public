<template>
  <section>
    <h2 id="the-header">The header</h2>
    <p>
      Every request carries your key as a bearer token. There is no other authentication scheme, no
      session to establish and no refresh to handle.
    </p>
    <DevCode :code="HEADER" language="bash" label="Header" />
    <p>
      Keys start with <code>wb_live_</code>. Requests to the API without the header, or with a key that
      has been revoked, come back <code>401</code>.
    </p>
  </section>

  <section>
    <h2 id="where-keys-come-from">Where keys come from</h2>
    <p>
      Create them on the <NuxtLink to="/developers/docs/api-keys">API keys</NuxtLink> page, or in the app
      under Settings → Developer. An account can hold several: one per script, per machine or per
      environment makes a leak cheap to contain, and the
      <NuxtLink to="/developers/docs/usage">usage breakdown</NuxtLink> tells you which key spent what.
    </p>
  </section>

  <section>
    <h2 id="keeping-a-key-safe">Keeping a key safe</h2>
    <p>
      A key is your whole library: it can read every bookmark and save new ones. Treat it like a
      password.
    </p>
    <ul>
      <li>Keep it on a server, in a secrets manager, or in an environment variable — never in a repository.</li>
      <li>Don't ship it inside a browser app, a mobile binary or a browser extension. Anything a user can install, a user can read.</li>
      <li>If a key has to reach the browser, put your own backend in front of the API and keep the key on it.</li>
      <li>Rotate on a schedule: create the replacement, deploy it, then revoke the old one. Nothing breaks in between.</li>
    </ul>
    <div class="docs-note warn">
      The <NuxtLink to="/developers/docs/playground">playground</NuxtLink> is the one place a key goes
      into a browser — your own, in your own tab. It is never sent to this website's server or stored.
    </div>
  </section>

  <section>
    <h2 id="revoking">Revoking</h2>
    <p>
      Revoking is immediate and cannot be undone — the next request made with that key gets a
      <code>401</code>. If you think a key has leaked, revoke first and work out the blast radius
      afterwards.
    </p>
    <DevApiKeysPanel />
  </section>
</template>

<script setup>
import DevCode from '~/components/developers/DevCode.vue'
import DevApiKeysPanel from '~/components/developers/DevApiKeysPanel.vue'

const HEADER = `Authorization: Bearer wb_live_…`
</script>
