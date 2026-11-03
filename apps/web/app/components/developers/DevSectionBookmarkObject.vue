<template>
  <section>
    <h2 id="fields">Fields</h2>
    <p>
      The shape you get from <code>GET /bookmarks/:id</code>, from each row of
      <code>GET /bookmarks</code>, and inside every webhook delivery. Listing endpoints return the
      smaller fields; the single-bookmark endpoint returns the lot.
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>
          <tr v-for="field in BOOKMARK_FIELDS" :key="field.name">
            <td><code>{{ field.name }}</code></td>
            <td><code>{{ field.type }}</code></td>
            <td>{{ field.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2 id="an-example">An example</h2>
    <DevCode :code="EXAMPLE" language="json" label="bookmark" />
    <div class="docs-note">
      A freshly created bookmark has most of this empty and <code>"status": "processing"</code> instead —
      see <NuxtLink to="/developers/docs/saving-bookmarks">Saving bookmarks</NuxtLink>.
    </div>
  </section>

  <section>
    <h2 id="types">Types</h2>
    <p>
      <code>type</code> says what kind of thing was saved, and it is what the app's type filter runs on.
      You will meet <code>website</code>, <code>article</code>, <code>image</code> and
      <code>textNote</code> most often; filter on whichever one you care about with
      <code>?type=</code>.
    </p>
  </section>

  <section>
    <h2 id="writing">What you can write</h2>
    <p>
      Through the API you set <code>url</code>, <code>tags</code> and <code>note</code> when you create a
      bookmark. Everything else is derived from the page — edit those in the app, and the API returns your
      edited version from then on.
    </p>
  </section>
</template>

<script setup>
import { BOOKMARK_FIELDS } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const EXAMPLE = `{
  "id": "abc123",
  "url": "https://example.com/an-article",
  "title": "An article",
  "description": "What the page says it is about.",
  "type": "article",
  "tags": ["reading", "research"],
  "note": "Cited in the Q3 deck",
  "summary": "A few sentences describing the page.",
  "image": "https://…/preview.jpg",
  "screenshot": "https://…/screenshot.jpg",
  "favicon": "https://…/favicon.ico",
  "createdAt": "2026-01-02T10:00:00.000Z"
}`
</script>
