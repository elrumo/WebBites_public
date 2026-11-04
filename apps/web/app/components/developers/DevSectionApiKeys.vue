<template>
  <section>
    <h2 id="your-keys">Your keys</h2>
    <p>
      Create as many as you like — one per script, machine or environment keeps a leak small and makes
      the <NuxtLink to="/developers/docs/usage">usage breakdown</NuxtLink> readable. A new key works
      immediately.
    </p>
    <DevApiKeysPanel />
  </section>

  <section>
    <h2 id="using-a-key">Using a key</h2>
    <p>Put it in the <code>Authorization</code> header of every request:</p>
    <DevCode :code="TEST" language="bash" label="Terminal" />
    <p>
      A <code>200</code> with a JSON body means the key is good. A <code>401</code> means the header never
      arrived or the key is no longer valid — see
      <NuxtLink to="/developers/docs/authentication">Authentication</NuxtLink>.
    </p>
  </section>

  <section>
    <h2 id="revoking-a-key">Revoking a key</h2>
    <p>
      The bin icon revokes a key on the spot; there is no undo and no grace period. Anything still using
      it starts getting <code>401</code>s with the next request, so rotate in this order:
    </p>
    <ol>
      <li>Create the new key.</li>
      <li>Deploy it wherever the old one lives.</li>
      <li>Watch the usage breakdown until the old key stops counting.</li>
      <li>Revoke the old key.</li>
    </ol>
    <div class="docs-note warn">
      We only ever show you a key on this page — treat the copy you save as the copy of record, and if
      you lose it, make a new one rather than hunting for it.
    </div>
  </section>
</template>

<script setup>
import { API_BASE_URL } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'
import DevApiKeysPanel from '~/components/developers/DevApiKeysPanel.vue'

const TEST = `curl -i ${API_BASE_URL}/usage \\
  -H "Authorization: Bearer wb_live_…"`
</script>
