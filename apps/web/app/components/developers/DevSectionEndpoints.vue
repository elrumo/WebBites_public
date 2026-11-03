<template>
  <section>
    <p class="docs-lead">
      Every endpoint, with its parameters, a request you can paste into a terminal and a sample response.
      All paths are relative to <code>{{ API_BASE_URL }}</code>, all requests carry
      <code>Authorization: Bearer …</code>, and everything is JSON in and JSON out.
    </p>
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="ep in ENDPOINTS"
        :key="ep.id"
        :to="`#endpoint-${ep.id}`"
        color="neutral"
        variant="soft"
        size="xs"
        class="font-mono"
      >
        {{ ep.method }} {{ ep.path }}
      </UButton>
    </div>
  </section>

  <section v-for="group in groups" :key="group.title">
    <h2 :id="group.id">{{ group.title }}</h2>
    <p>{{ group.blurb }}</p>
    <DevEndpointCard v-for="ep in group.endpoints" :key="ep.id" :endpoint="ep" />
  </section>

  <section>
    <h2 id="the-full-reference">The generated reference</h2>
    <p>
      This page is the hand-written version. The
      <a :href="OPENAPI_URL" target="_blank" rel="noopener">OpenAPI document</a> is generated from the
      server itself — point your client generator at it, or read it when you want the exact schema of a
      field rather than an example of it.
    </p>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { ENDPOINTS, ENDPOINT_GROUPS, API_BASE_URL, OPENAPI_URL } from '~/utils/devApi'
import DevEndpointCard from '~/components/developers/DevEndpointCard.vue'

const BLURBS = {
  Bookmarks: 'Read and write the library itself.',
  Account: 'What your plan allows and what you have spent.',
  Webhooks: 'Register the endpoints we push finished bookmarks to.',
}

const groups = computed(() =>
  ENDPOINT_GROUPS.map(title => ({
    title,
    id: title.toLowerCase(),
    blurb: BLURBS[title],
    endpoints: ENDPOINTS.filter(ep => ep.group === title),
  })).filter(group => group.endpoints.length)
)
</script>
