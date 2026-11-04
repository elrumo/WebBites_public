<template>
  <nav v-if="items.length" class="dev-toc" aria-label="On this page">
    <p class="dev-toc-title">On this page</p>
    <ul>
      <li v-for="item in items" :key="item.id">
        <a
          :href="`#${item.id}`"
          class="dev-toc-link"
          :class="[`level-${item.level}`, { active: item.id === activeId }]"
          @click.prevent="goTo(item.id)"
        >
          {{ item.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  /** The element whose headings make up the table of contents. */
  container: { type: Object, default: null },
  /** Changing this rebuilds the list — the shell passes the current slug. */
  slug: { type: String, default: '' },
})

const items = ref([])
const activeId = ref('')
let observer = null

const build = async () => {
  await nextTick()
  observer?.disconnect()
  items.value = []

  const root = props.container
  if (!root?.querySelectorAll) return

  const headings = [...root.querySelectorAll('h2[id], h3[id]')]
  items.value = headings.map(h => ({
    id: h.id,
    text: h.textContent.trim(),
    level: Number(h.tagName.slice(1)),
  }))
  activeId.value = headings[0]?.id || ''
  if (!headings.length) return

  // Highlight the topmost heading in the band just under the navbar.
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) activeId.value = visible[0].target.id
    },
    { rootMargin: '-100px 0px -68% 0px', threshold: 0 }
  )
  headings.forEach(h => observer.observe(h))
}

const goTo = (id) => {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeId.value = id
  history.replaceState(null, '', `#${id}`)
}

onMounted(build)
watch(() => [props.container, props.slug], build)
onBeforeUnmount(() => observer?.disconnect())
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-toc { @apply flex flex-col gap-2 text-sm; }

.dev-toc-title {
  @apply px-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500;
}

.dev-toc-link {
  @apply block border-l border-white/10 py-1 pl-3 text-[13px] leading-snug text-neutral-500 transition;
  @apply hover:text-white;
  @apply focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}
.dev-toc-link.level-3 { @apply pl-6; }
.dev-toc-link.active { @apply border-green-400 text-white; }
</style>
