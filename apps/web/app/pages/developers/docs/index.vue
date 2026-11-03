<template>
  <DevDocsShell slug="" />
</template>

<script setup>
import DevDocsShell from '~/components/developers/DevDocsShell.vue'

// Match the [slug] page: no whole-page fade when moving between docs.
definePageMeta({ pageTransition: false })
</script>
