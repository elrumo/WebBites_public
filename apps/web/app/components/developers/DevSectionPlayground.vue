<template>
  <section>
    <h2 id="try-a-request">Try a request</h2>
    <p>
      Pick an endpoint, pick a key, fill in what it needs and send it. This is the real API against your
      real library — a <code>POST /bookmarks</code> here saves a bookmark for real.
    </p>
    <DevPlaygroundPanel />
  </section>

  <section>
    <h2 id="how-it-works">What it is doing</h2>
    <p>
      The request goes straight from your browser to <code>{{ API_BASE_URL }}</code> with the key you
      chose in the <code>Authorization</code> header — the same request the curl samples make. Nothing is
      proxied through this website and nothing is stored: reload the page and the key is gone.
    </p>
    <p>
      The badges above the response are the <NuxtLink to="/developers/docs/rate-limits">rate limit
      headers</NuxtLink> that came back with it, so you can watch your remaining allowance tick down as
      you experiment.
    </p>
    <div class="docs-note">
      Signed in? Your keys appear in the dropdown. Otherwise paste one — a key from any account works
      here, because the API only ever cares about the key.
    </div>
  </section>

  <section>
    <h2 id="when-it-fails">When it fails</h2>
    <ul>
      <li><strong>0 Network error</strong> — the request never reached the API. Usually an extension or a network blocking the call, rather than anything wrong with the request itself.</li>
      <li><strong>401</strong> — the key is wrong, revoked, or was pasted with whitespace around it.</li>
      <li><strong>429</strong> — you are over a limit. The badges say which, and <NuxtLink to="/developers/docs/usage">usage</NuxtLink> says how much is left.</li>
      <li><strong>Anything else</strong> — the body is shown verbatim; <NuxtLink to="/developers/docs/errors">Errors</NuxtLink> covers what each status means.</li>
    </ul>
  </section>
</template>

<script setup>
import { API_BASE_URL } from '~/utils/devApi'
import DevPlaygroundPanel from '~/components/developers/DevPlaygroundPanel.vue'
</script>
