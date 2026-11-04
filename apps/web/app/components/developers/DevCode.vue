<template>
  <div class="dev-code" :class="{ 'has-header': showHeader }">
    <div v-if="showHeader" class="dev-code-header">
      <!-- Tabs when there is more than one language, a plain label otherwise. -->
      <div v-if="tabs.length > 1" class="dev-code-tabs" role="tablist">
        <button
          v-for="(tab, i) in tabs"
          :key="tab.label"
          type="button"
          role="tab"
          :aria-selected="i === active"
          class="dev-code-tab"
          :class="{ active: i === active }"
          @click="active = i"
        >
          {{ tab.label }}
        </button>
      </div>
      <span v-else class="dev-code-label">{{ label || tabs[0]?.label }}</span>

      <button type="button" class="dev-code-copy" :aria-label="copied ? 'Copied' : 'Copy code'" @click="copyCode">
        <UIcon :name="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard-document'" class="size-4" />
        <span>{{ copied ? 'Copied' : 'Copy' }}</span>
      </button>
    </div>

    <pre class="dev-code-pre"><code class="dev-code-body" v-html="highlighted" /></pre>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'

// Registering is idempotent, and this runs once per module rather than per block.
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)

const props = defineProps({
  /** A single snippet. Ignored when `tabs` is given. */
  code: { type: String, default: '' },
  language: { type: String, default: 'bash' },
  /** [{ label, language, code }] — renders a tab per language. */
  tabs: { type: Array, default: () => [] },
  /** Header text for a single snippet. Leave empty to hide the header. */
  label: { type: String, default: '' },
})

const active = ref(0)

const tabs = computed(() =>
  props.tabs.length ? props.tabs : [{ label: props.label, language: props.language, code: props.code }]
)
const current = computed(() => tabs.value[active.value] || tabs.value[0])
const showHeader = computed(() => props.tabs.length > 1 || Boolean(props.label))

// hljs escapes its own output; the fallback has to do it itself.
const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const highlighted = computed(() => {
  const { code = '', language = 'bash' } = current.value || {}
  if (!hljs.getLanguage(language)) return escapeHtml(code)
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(code)
  }
})

const copied = ref(false)
let resetTimer = null
const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(current.value?.code || '')
    copied.value = true
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-code {
  @apply rounded-xl border border-white/10 bg-neutral-900/80 overflow-hidden;
}

.dev-code-header {
  @apply flex items-center gap-2 border-b border-white/10 bg-white/[0.03] pl-2 pr-2 py-1.5;
}

.dev-code-tabs { @apply flex items-center gap-1 overflow-x-auto; scrollbar-width: none; }
.dev-code-tabs::-webkit-scrollbar { display: none; }

.dev-code-tab {
  @apply rounded-lg px-2.5 py-1 text-xs font-semibold text-neutral-400 whitespace-nowrap transition cursor-pointer;
  @apply hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}
.dev-code-tab.active { @apply bg-white/10 text-white; }

.dev-code-label {
  @apply px-1.5 font-mono text-xs font-medium text-neutral-400;
}

.dev-code-copy {
  @apply ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-neutral-400 transition cursor-pointer;
  @apply hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}

.dev-code-pre {
  @apply overflow-x-auto px-4 py-3 text-[13px] leading-relaxed;
}

.dev-code-body {
  @apply font-mono text-neutral-200;
}

/* A small highlight.js theme, tuned to the green the rest of the site uses. */
.dev-code-body :deep(.hljs-comment),
.dev-code-body :deep(.hljs-quote) { @apply text-neutral-500 italic; }
.dev-code-body :deep(.hljs-string),
.dev-code-body :deep(.hljs-attr),
.dev-code-body :deep(.hljs-attribute),
.dev-code-body :deep(.hljs-addition) { @apply text-green-300; }
.dev-code-body :deep(.hljs-number),
.dev-code-body :deep(.hljs-literal),
.dev-code-body :deep(.hljs-symbol) { @apply text-amber-300; }
.dev-code-body :deep(.hljs-keyword),
.dev-code-body :deep(.hljs-selector-tag),
.dev-code-body :deep(.hljs-built_in),
.dev-code-body :deep(.hljs-meta) { @apply text-sky-300; }
.dev-code-body :deep(.hljs-title),
.dev-code-body :deep(.hljs-section),
.dev-code-body :deep(.hljs-name) { @apply text-violet-300; }
.dev-code-body :deep(.hljs-variable),
.dev-code-body :deep(.hljs-template-variable),
.dev-code-body :deep(.hljs-params) { @apply text-neutral-200; }
.dev-code-body :deep(.hljs-deletion) { @apply text-red-300; }
</style>
