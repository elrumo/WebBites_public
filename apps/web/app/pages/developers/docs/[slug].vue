<template>
  <DevDocsShell :slug="slug" />
</template>

<script setup>
import { computed } from 'vue'
import DevDocsShell from '~/components/developers/DevDocsShell.vue'

// Sidebar navigation between docs should feel instant, not fade the whole page.
definePageMeta({ pageTransition: false })

const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))
</script>
