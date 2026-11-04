<template>
  <nav class="dev-nav" aria-label="Documentation">
    <div class="dev-nav-search">
      <UIcon name="i-heroicons-magnifying-glass" class="size-4 shrink-0 text-neutral-500" />
      <input
        v-model="query"
        type="search"
        placeholder="Search the docs"
        aria-label="Search the docs"
        class="dev-nav-input"
      >
    </div>

    <p v-if="!groups.length" class="dev-nav-empty">Nothing matches “{{ query }}”.</p>

    <div v-for="group in groups" :key="group.title" class="dev-nav-group">
      <div class="dev-nav-group-title">
        <UIcon :name="group.icon" class="size-3.5" />
        {{ group.title }}
      </div>
      <ul>
        <li v-for="item in group.items" :key="item.slug">
          <NuxtLink
            :to="docPath(item.slug)"
            class="dev-nav-link"
            :class="{ active: item.slug === (currentSlug || '') }"
            @click="emit('navigate')"
          >
            {{ item.title }}
          </NuxtLink>
        </li>
      </ul>
    </div>

    <div class="dev-nav-group">
      <div class="dev-nav-group-title">
        <UIcon name="i-heroicons-arrow-top-right-on-square" class="size-3.5" />
        More
      </div>
      <ul>
        <li>
          <a :href="OPENAPI_URL" target="_blank" rel="noopener" class="dev-nav-link">OpenAPI reference</a>
        </li>
        <li><NuxtLink to="/developers" class="dev-nav-link" @click="emit('navigate')">Developers home</NuxtLink></li>
        <li><NuxtLink to="/support" class="dev-nav-link" @click="emit('navigate')">Get help</NuxtLink></li>
      </ul>
    </div>
  </nav>
</template>

<script setup>
import { ref, computed } from 'vue'
import { DOC_GROUPS, docPath } from '~/utils/devDocs'
import { OPENAPI_URL } from '~/utils/devApi'

defineProps({
  currentSlug: { type: String, default: '' },
})
const emit = defineEmits(['navigate'])

const query = ref('')

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return DOC_GROUPS
  return DOC_GROUPS
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        `${item.title} ${item.description} ${item.keywords || ''}`.toLowerCase().includes(q)
      ),
    }))
    .filter(group => group.items.length)
})
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-nav { @apply flex flex-col gap-6 text-sm; }

.dev-nav-search {
  @apply flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2;
  @apply focus-within:border-green-400/50;
}

.dev-nav-input {
  @apply w-full bg-transparent text-sm text-white placeholder:text-neutral-500 outline-none;
}
.dev-nav-input::-webkit-search-cancel-button { @apply hidden; }

.dev-nav-empty { @apply text-sm text-neutral-500; }

.dev-nav-group { @apply flex flex-col gap-1.5; }

.dev-nav-group-title {
  @apply flex items-center gap-2 px-2 text-[11px] font-semibold text-neutral-500;
}

.dev-nav-link {
  @apply block rounded-lg border-l-2 border-transparent px-2 py-1.5 text-[15px] text-neutral-400 transition;
  @apply hover:bg-white/[0.04] hover:text-white;
  @apply focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}

.dev-nav-link.active {
  @apply border-green-400/70 bg-white/[0.04] font-semibold text-white;
}
</style>
