<template>
  <!-- The composer's "#" pill, after the native composer's: the glyph and
       "Tag" until there are any, then how many. The tags themselves show as
       chips above the row (see newBookmark), so the pill never has to grow to
       hold them. Same picker as the details panel: the user's own tags from
       the index, ranked by use, and anything typed can become a new one. -->
  <USelectMenu
    v-model="selected"
    v-model:search-term="query"
    :items="items"
    value-key="label"
    variant="none"
    icon="i-heroicons-hashtag"
    :loading="loading"
    :search-input="{ placeholder: $t('common.add_tag') }"
    :content="{ side: 'top', align: 'start', sideOffset: 8 }"
    :ui="{
      base: ['nb-pill w-auto', selected.length ? 'nb-pill--on' : ''].join(' '),
      leading: 'static p-0',
      leadingIcon: 'size-4 shrink-0 text-current',
      trailing: 'hidden',
      content: 'z-[1000] w-64 max-w-[calc(100vw-2rem)]'
    }"
    :aria-label="selected.length ? $t('bookmarks.compose.tags_count', { count: selected.length }) : $t('bookmarks.compose.add_tag')"
    multiple
    ignore-filter
    :create-item="{ when: 'always', position: 'top' }"
    @create="add"
    @update:open="onOpen"
  >
    <template #default>
      <span class="tabular-nums">{{ selected.length ? selected.length : $t('bookmarks.compose.tag') }}</span>
    </template>
    <template #item-trailing="{ item }">
      <span v-if="item.count" class="text-xs opacity-50 tabular-nums">{{ item.count }}</span>
    </template>
  </USelectMenu>
</template>

<script setup>
import { ref, computed } from 'vue'
import { watchDebounced } from '@vueuse/core'

/** The picked tags, as plain strings. */
const model = defineModel({ type: Array, default: () => [] })

const selected = computed({
  get: () => model.value,
  set: (labels) => {
    model.value = [...new Set(labels.map(tag => String(tag?.label ?? tag).trim()).filter(Boolean))]
  }
})

const { list: listTags } = useTags()
const items = ref([])
const query = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await listTags(query.value, 0)
    items.value = (res?.tags || []).map(tag => ({ label: tag.name, count: tag.count }))
  } catch {
    // Offline or signed out: typing a tag still creates it.
    items.value = []
  } finally {
    loading.value = false
  }
}

watchDebounced(query, load, { debounce: 200 })

function onOpen(open) {
  if (open && !items.value.length) load()
}

function add(label) {
  const typed = String(label).replace(/[\r\n#]/g, '').trim()
  if (!typed) return
  // Reuse the existing casing so "design" does not get created next to "Design".
  const existing = items.value.find(item => item.label.toLowerCase() === typed.toLowerCase())
  const tag = existing?.label ?? typed
  if (!existing) items.value.unshift({ label: tag, count: 0 })
  query.value = ''
  selected.value = [...selected.value, tag]
}
</script>
