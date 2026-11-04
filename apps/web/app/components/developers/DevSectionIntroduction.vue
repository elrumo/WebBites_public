<template>
  <section>
    <h2 id="what-it-is">What this API is</h2>
    <p>
      A small REST API over your WebBites library. You authenticate with an API key, send JSON, and get
      JSON back. There is no SDK to install and nothing to configure — if your language can make an HTTP
      request, it can talk to WebBites.
    </p>
    <p>
      Everything you reach through it belongs to the account the key was made on: your bookmarks, your
      tags, your usage, your webhooks. There is no way to read anybody else's library with it.
    </p>

    <div class="docs-note">
      Base URL — every path on this site is relative to it:
      <code>{{ API_BASE_URL }}</code>
    </div>
  </section>

  <section>
    <h2 id="what-you-can-do">What you can do with it</h2>
    <div class="docs-cards">
      <div v-for="item in capabilities" :key="item.title" class="docs-card">
        <div class="docs-card-title">{{ item.title }}</div>
        <div class="docs-card-text">{{ item.text }}</div>
      </div>
    </div>
  </section>

  <section>
    <h2 id="how-a-save-works">How a save works</h2>
    <p>
      Saving is asynchronous, and that shapes most of the code you will write against this API.
      <code>POST /bookmarks</code> answers immediately with <code>"status": "processing"</code>, then the
      screenshot, the summary and the automatic tags are generated in the background. A minute later the
      same bookmark comes back with all of it filled in.
    </p>
    <ol>
      <li><strong>You post a URL.</strong> The response carries the new bookmark's <code>id</code> straight away.</li>
      <li><strong>We fetch and enrich the page.</strong> Screenshot, description, summary, tags, favicon.</li>
      <li><strong>You find out it is done</strong> — through a <NuxtLink to="/developers/docs/webhooks">webhook</NuxtLink>, or by re-reading <code>GET /bookmarks/:id</code>.</li>
    </ol>
    <p>
      The <NuxtLink to="/developers/docs/saving-bookmarks">Saving bookmarks</NuxtLink> guide has the code
      for both routes.
    </p>
  </section>

  <section>
    <h2 id="where-to-start">Where to start</h2>
    <div class="docs-cards">
      <NuxtLink v-for="item in next" :key="item.to" :to="item.to" class="docs-card docs-card-hover no-underline">
        <div class="docs-card-title">{{ item.title }}</div>
        <div class="docs-card-text">{{ item.text }}</div>
      </NuxtLink>
    </div>
    <p>
      The generated <a :href="OPENAPI_URL" target="_blank" rel="noopener">OpenAPI reference</a> is the
      machine-readable source of truth, and stays in step with the server.
    </p>
  </section>
</template>

<script setup>
import { API_BASE_URL, OPENAPI_URL } from '~/utils/devApi'

const capabilities = [
  { title: 'Save anything', text: 'POST a URL and it lands in your library, enriched the same way a save from the app is.' },
  { title: 'Read your library', text: 'List, filter and full-text search your bookmarks, then page through the lot with a cursor.' },
  { title: 'React to saves', text: 'Register a webhook and get a signed POST the moment a bookmark finishes processing.' },
  { title: 'Watch your quota', text: 'GET /usage returns your plan, its limits and what you have spent this month, per key.' },
]

const next = [
  { to: '/developers/docs/quickstart', title: 'Quickstart', text: 'A key, a curl, a saved bookmark. About two minutes.' },
  { to: '/developers/docs/endpoints', title: 'Endpoints', text: 'Every route with its parameters and a sample response.' },
  { to: '/developers/docs/playground', title: 'Playground', text: 'Fire a real request without leaving the page.' },
  { to: '/developers/docs/recipes', title: 'Recipes', text: 'Copy-paste programs: a backup, a Slack command, a digest.' },
]
</script>
