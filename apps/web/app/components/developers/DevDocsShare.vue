<template>
  <div class="dev-docs-share">
    <!-- Primary action: copy the page's Markdown to the clipboard. -->
    <UButton
      color="neutral"
      variant="outline"
      size="sm"
      :icon="copied ? 'i-heroicons-check' : 'i-heroicons-document-duplicate'"
      class="dev-docs-share-main"
      @click="copyPage"
    >
      {{ copied ? 'Copied' : 'Copy page' }}
    </UButton>

    <UDropdownMenu :items="items" :content="{ align: 'end' }" :ui="{ content: 'w-56' }">
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        square
        icon="i-heroicons-chevron-down"
        class="dev-docs-share-caret"
        aria-label="Open this page with an LLM"
      />
    </UDropdownMenu>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  /** The docs slug; '' is the introduction, served as index.md. */
  slug: { type: String, default: '' },
})

const mdPath = computed(() => `/developers/docs/${props.slug || 'index'}.md`)
const mdUrl = computed(() => useRequestURL().origin + mdPath.value)
const llmPrompt = computed(
  () => `Read ${mdUrl.value} — it is a WebBites API documentation page — then help me build against it.`
)

const copied = ref(false)
let timer = null
const flash = () => {
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 1600)
}

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    flash()
  } catch {
    /* clipboard unavailable (insecure context, denied) — the menu links still work */
  }
}

const copyPage = async () => {
  try {
    const md = await $fetch(mdPath.value, { responseType: 'text' })
    await copyText(String(md))
  } catch {
    // Fall back to copying the link if the fetch fails.
    await copyText(mdUrl.value)
  }
}

const openTab = (url) => window.open(url, '_blank', 'noopener')

const items = computed(() => [
  { label: 'Copy markdown link', icon: 'i-heroicons-link', onSelect: () => copyText(mdUrl.value) },
  { label: 'View as markdown', icon: 'i-heroicons-document-text', onSelect: () => openTab(mdUrl.value) },
  {
    label: 'Open in ChatGPT',
    icon: 'i-tabler-brand-openai',
    onSelect: () => openTab(`https://chatgpt.com/?hints=search&q=${encodeURIComponent(llmPrompt.value)}`),
  },
  {
    label: 'Open in Claude',
    icon: 'i-heroicons-sparkles',
    onSelect: () => openTab(`https://claude.ai/new?q=${encodeURIComponent(llmPrompt.value)}`),
  },
])
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

/* Join the two buttons into one control, the way the reference "Copy page ▾" is. */
.dev-docs-share { @apply flex items-center; }
.dev-docs-share-main :deep(button),
.dev-docs-share-main { @apply rounded-r-none; }
.dev-docs-share-caret { @apply -ml-px rounded-l-none; }
</style>
