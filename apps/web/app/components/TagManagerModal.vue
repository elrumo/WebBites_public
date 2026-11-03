<template>
  <UModal v-model:open="showTagManagerModal" :ui="{ content: 'sm:max-w-xl' }">
    <template #content>
      <div class="flex flex-col max-h-[80vh]">
        <div class="p-5 pb-3 flex flex-row items-start gap-3">
          <div class="flex-1 min-w-0 flex flex-col gap-1">
            <div class="flex flex-row items-center gap-2">
              <h5 class="m-0 font-semibold">{{ $t('tags.manage') }}</h5>
              <UBadge v-if="total" color="neutral" variant="soft" size="sm" class="tabular-nums">{{ total }}</UBadge>
            </div>
            <p class="m-0 text-sm opacity-60">{{ $t('tags.subtitle') }}</p>
          </div>
          <UButton
            color="neutral" variant="ghost" size="sm" icon="i-heroicons-x-mark"
            :aria-label="$t('common.close')" @click="showTagManagerModal = false"
          />
        </div>

        <div class="px-5 pb-3 flex flex-row gap-2 items-center">
          <UInput
            v-model="query"
            :placeholder="$t('tags.search')"
            icon="i-heroicons-magnifying-glass"
            size="sm"
            class="flex-1"
            autofocus
          />
          <div class="segmented" role="radiogroup">
            <button
              v-for="option in sortOptions"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="sort === option.value"
              :aria-label="option.label"
              class="segmented-item"
              :class="{ 'segmented-item-active': sort === option.value }"
              @click="sort = option.value"
            >
              <UIcon :name="option.icon" class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">{{ option.label }}</span>
            </button>
          </div>
        </div>

        <div class="flex-1 min-h-0 px-2 pb-2 border-t border-neutral-100 dark:border-white/10 pt-2">
          <div v-if="loading && !tags.length" class="empty">
            <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 opacity-40 animate-spin" />
          </div>
          <div v-else-if="!tags.length" class="empty">
            <UIcon name="i-tabler-tags" class="w-8 h-8 opacity-30" />
            <p class="text-sm opacity-60 m-0">{{ query ? $t('tags.no_match') : $t('tags.empty') }}</p>
          </div>
          <RecycleScroller
            v-else
            class="h-[50vh]"
            :items="tags"
            :item-size="44"
            key-field="name"
            emit-update
            @update="(start, end) => end >= tags.length && loadMore()"
            @scroll.passive="preview = null"
          >
            <template #default="{ item }">
              <div
                class="tag-row group"
                :class="{ 'tag-row-selected': selected.has(item.name), 'tag-row-locked': isProtected(item.name) }"
                :title="isProtected(item.name) ? $t('tags.protected') : undefined"
                @click="toggle(item.name)"
              >
                <UIcon v-if="isProtected(item.name)" name="i-tabler-lock" class="w-4 h-4 opacity-40 shrink-0" />
                <UCheckbox
                  v-else
                  :ui="{ base: 'dark:ring-white/30' }"
                  :model-value="selected.has(item.name)"
                  @click.stop
                  @update:model-value="toggle(item.name)"
                />
                <span class="tag-name">
                  <button
                    type="button"
                    class="tag-name-button"
                    :class="{ 'tag-name-button-active': preview?.name === item.name }"
                    :aria-label="$t('tags.preview', { tag: item.name })"
                    @click.stop="openPreview(item, $event.currentTarget.closest('.tag-row'))"
                  >
                    <span class="opacity-40">#</span><span class="truncate">{{ item.name }}</span>
                  </button>
                </span>

                <div class="row-actions" @click.stop>
                  <UButton
                    v-if="!isProtected(item.name)"
                    size="xs" variant="ghost" color="neutral" icon="i-heroicons-pencil"
                    :aria-label="$t('tags.rename')" @click="renameOne(item.name)"
                  />
                </div>

                <div class="flex flex-row items-center gap-2 shrink-0 sm:w-24 justify-end">
                  <div class="usage-bar"><div class="usage-fill" :style="{ width: `${(item.count / maxCount) * 100}%` }" /></div>
                  <span class="text-xs opacity-60 tabular-nums w-8 text-right" :title="$t('tags.bookmarks_count', item.count)">{{ item.count }}</span>
                </div>
              </div>
            </template>
          </RecycleScroller>

          <!-- One popover for the whole list, anchored to the clicked tag: rows are recycled. -->
          <UPopover
            :open="!!preview"
            :reference="previewAnchor"
            :content="previewContent"
            :ui="{ content: 'flex flex-col max-h-(--reka-popover-content-available-height)' }"
            @update:open="(open) => !open && (preview = null)"
          >
            <template #content>
              <div v-if="preview" class="w-72 flex flex-col min-h-0">
                <div class="px-3 pt-3 pb-2 flex flex-row items-center gap-2">
                  <span class="text-sm font-semibold truncate flex-1"><span class="opacity-40">#</span>{{ preview.name }}</span>
                  <span class="text-xs opacity-60 shrink-0">{{ $t('tags.bookmarks_count', preview.count) }}</span>
                </div>
                <div class="px-1.5 flex-1 min-h-0 max-h-96 overflow-y-auto">
                  <div v-if="previewLoading" class="empty py-6!">
                    <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 opacity-40 animate-spin" />
                  </div>
                  <p v-else-if="!previewSites.length" class="text-sm opacity-60 text-center py-6 m-0">{{ $t('tags.preview_empty') }}</p>
                  <button
                    v-for="site in previewSites"
                    v-else
                    :key="site.objectId"
                    type="button"
                    class="preview-row"
                    @click="openSite(site)"
                  >
                    <img v-if="site.siteLogo" :src="site.siteLogo" alt="" class="size-5 rounded shrink-0 object-cover" loading="lazy" />
                    <UIcon v-else name="i-heroicons-document" class="size-5 opacity-50 shrink-0" />
                    <span class="flex flex-col min-w-0 text-left">
                      <span class="text-sm truncate">{{ site.siteTitle || site.url || $t('tag_manager.untitled') }}</span>
                      <span v-if="site.url" class="text-xs opacity-50 truncate">{{ hostOf(site.url) }}</span>
                    </span>
                  </button>
                </div>
                <div class="p-1.5 border-t border-neutral-100 dark:border-white/10 mt-1.5">
                  <UButton
                    block size="sm" variant="ghost" color="neutral" trailing-icon="i-heroicons-arrow-right"
                    :label="$t('tags.show_all', preview.count)" @click="filterBy(preview.name)"
                  />
                </div>
              </div>
            </template>
          </UPopover>
        </div>

        <!-- Bulk actions, shown once something is selected. -->
        <div v-if="selected.size" class="tag-footer">
          <template v-if="mode === 'rename'">
            <UInput
              v-model="renameTo"
              size="sm"
              class="flex-1"
              autofocus
              @keydown.enter="rename"
              @keydown.esc="mode = null"
            />
            <UButton size="sm" color="neutral" variant="ghost" :label="$t('common.cancel')" @click="mode = null" />
            <UButton size="sm" :loading="busy" :label="$t('tags.rename')" @click="rename" />
          </template>

          <template v-else-if="mode === 'merge'">
            <span class="text-sm opacity-60 shrink-0">{{ $t('tags.merge_into') }}</span>
            <USelect v-model="mergeInto" :items="selectedNames" size="sm" class="flex-1 min-w-0" />
            <UButton size="sm" color="neutral" variant="ghost" :label="$t('common.cancel')" @click="mode = null" />
            <UButton size="sm" :loading="busy" :label="$t('tags.merge')" @click="merge" />
          </template>

          <template v-else-if="mode === 'remove'">
            <span class="text-sm flex-1 min-w-0">{{ $t('tags.confirm_delete') }}</span>
            <UButton size="sm" color="neutral" variant="ghost" :label="$t('common.cancel')" @click="mode = null" />
            <UButton size="sm" color="error" :loading="busy" :label="$t('tags.delete')" @click="remove" />
          </template>

          <template v-else>
            <UButton
              size="sm" variant="ghost" color="neutral" icon="i-heroicons-x-mark"
              :aria-label="$t('tags.clear_selection')" @click="selected.clear()"
            />
            <span class="text-sm font-medium flex-1 whitespace-nowrap">{{ $t('tags.selected', selected.size) }}</span>
            <UButton
              v-if="selected.size === 1"
              size="sm" variant="soft" color="neutral" icon="i-heroicons-pencil"
              :label="$t('tags.rename')" @click="startRename"
            />
            <UButton
              v-else
              size="sm" variant="soft" color="neutral" icon="i-tabler-arrow-merge"
              :label="$t('tags.merge')" @click="startMerge"
            />
            <UButton
              size="sm" variant="soft" color="error" icon="i-heroicons-trash"
              :label="$t('tags.delete')" @click="mode = 'remove'"
            />
          </template>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { watchDebounced, useMediaQuery } from '@vueuse/core'
import { useStore } from '~/stores/myStore'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

const PROTECTED = ['read-later']

const store = useStore()
const { showTagManagerModal, selectedTags, webToShow, showWebsiteModal } = storeToRefs(store)
const { list, merge: mergeTags, bookmarks } = useTags()
const { t } = useI18n()

const tags = ref([])
const total = ref(0)
const query = ref('')
const sort = ref('count')
const page = ref(0)
const hasMore = ref(false)
const loading = ref(false)

const sortOptions = computed(() => [
  { value: 'count', label: t('tags.sort_count'), icon: 'i-heroicons-bars-arrow-down' },
  { value: 'name', label: t('tags.sort_name'), icon: 'i-heroicons-language' }
])

const selected = reactive(new Set())
const selectedNames = computed(() => [...selected])
const isProtected = name => PROTECTED.includes(name.toLowerCase())
// Usage bars are relative to the busiest tag loaded so far.
const maxCount = computed(() => Math.max(1, ...tags.value.map(tag => tag.count)))

// Tag whose bookmarks the popover shows, and the element it hangs off.
const preview = ref(null)
const previewAnchor = ref(null)
const previewSites = ref([])
const previewLoading = ref(false)

const busy = ref(false)
const mode = ref(null) // null | 'rename' | 'merge' | 'remove'
const renameTo = ref('')
const mergeInto = ref('')

let requestId = 0
async function load(reset) {
  if (reset) { page.value = 0; hasMore.value = false }
  const id = ++requestId
  loading.value = true
  try {
    const res = await list(query.value, page.value, sort.value)
    if (id !== requestId) return // superseded by a newer reset/page
    tags.value = reset ? res.tags : [...tags.value, ...res.tags]
    total.value = res.total
    hasMore.value = res.hasMore
  } finally {
    if (id === requestId) loading.value = false
  }
}

function loadMore() {
  if (!hasMore.value || loading.value) return
  page.value++
  load(false)
}

watch(showTagManagerModal, (open) => { preview.value = null; if (open) { selected.clear(); load(true) } }, { immediate: true })
watch(sort, () => { preview.value = null; load(true) })
watchDebounced(query, () => load(true), { debounce: 200 })

function toggle(name) {
  if (isProtected(name)) return
  selected.has(name) ? selected.delete(name) : selected.add(name)
  mode.value = null
}

// Beside the modal on desktop; phones have no room there, so under the row.
const wide = useMediaQuery('(min-width: 640px)')
const previewContent = computed(() => ({
  side: wide.value ? 'right' : 'bottom',
  align: 'start',
  sideOffset: wide.value ? 16 : 4,
  // Tag names toggle/switch the preview themselves; don't let the press close it first.
  onInteractOutside: e => e.target?.closest?.('.tag-name-button') && e.preventDefault()
}))

async function openPreview(tag, el) {
  if (preview.value?.name === tag.name) { preview.value = null; return }
  preview.value = tag
  previewAnchor.value = el
  previewSites.value = []
  previewLoading.value = true
  try {
    const sites = await bookmarks(tag.name)
    if (preview.value?.name === tag.name) previewSites.value = sites
  } catch {
    if (preview.value?.name === tag.name) previewSites.value = []
  } finally {
    if (preview.value?.name === tag.name) previewLoading.value = false
  }
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

function openSite(site) {
  preview.value = null
  showTagManagerModal.value = false
  webToShow.value = site
  showWebsiteModal.value = true
}

function filterBy(name) {
  preview.value = null
  store.setSelectedTag(name)
  showTagManagerModal.value = false
}

function startRename() {
  renameTo.value = selectedNames.value[0]
  mode.value = 'rename'
}

function renameOne(name) {
  selected.clear()
  selected.add(name)
  startRename()
}

function startMerge() {
  // Default to the most-used of the selection; the list is already ranked.
  mergeInto.value = tags.value.find(tag => selected.has(tag.name))?.name ?? selectedNames.value[0]
  mode.value = 'merge'
}

async function apply(from, into) {
  busy.value = true
  try {
    const { updated } = await mergeTags(from, into)
    // The filter chips in the search bar must follow a rename.
    if (into) selectedTags.value = selectedTags.value.map(tag => from.some(f => f.toLowerCase() === tag.toLowerCase()) ? into.toLowerCase() : tag)
    else selectedTags.value = selectedTags.value.filter(tag => !from.some(f => f.toLowerCase() === tag.toLowerCase()))
    store.showAlert({ message: t('tags.updated', updated) })
    selected.clear()
    mode.value = null
    await load(true)
    store.searchSites(store.searchValue)
  } catch (error) {
    store.showAlert({ message: error?.data?.statusMessage || error?.message || t('tag_manager.error_generic'), type: 'danger' })
  } finally {
    busy.value = false
  }
}

function rename() {
  const into = renameTo.value.trim()
  if (!into || into === selectedNames.value[0]) { mode.value = null; return }
  apply(selectedNames.value, into)
}

function merge() {
  const into = mergeInto.value
  apply(selectedNames.value.filter(n => n !== into), into)
}

function remove() {
  apply(selectedNames.value, null)
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.segmented {
  @apply flex flex-row p-0.5 gap-0.5 rounded-lg shrink-0;
  @apply bg-neutral-100 dark:bg-white/5;
}

.segmented-item {
  @apply flex flex-row items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium cursor-pointer;
  @apply text-neutral-500 dark:text-neutral-400 transition-colors;
  @apply hover:text-neutral-900 dark:hover:text-neutral-100;
}

.segmented-item-active {
  @apply bg-white dark:bg-white/10 text-neutral-900 dark:text-neutral-100 shadow-sm;
}

.tag-row {
  @apply h-11 flex flex-row items-center gap-3 px-3 mx-1 rounded-lg cursor-pointer select-none;
  @apply hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors;
}

.tag-row-selected {
  @apply bg-neutral-100 dark:bg-white/10;
}

.tag-row-locked {
  @apply cursor-default;
}

.tag-name {
  @apply flex-1 min-w-0 flex flex-row items-center text-sm font-medium;
}

.tag-name-button {
  @apply min-w-0 flex flex-row items-center rounded-md -mx-1.5 px-1.5 py-0.5 cursor-pointer;
  @apply hover:bg-neutral-200/70 dark:hover:bg-white/10 transition-colors;
}

.tag-name-button-active {
  @apply bg-neutral-200/70 dark:bg-white/10;
}

.preview-row {
  @apply w-full flex flex-row items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer;
  @apply hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors;
}

.row-actions {
  @apply flex flex-row items-center shrink-0 opacity-0 transition-opacity;
  @apply group-hover:opacity-100 focus-within:opacity-100;
}

.usage-bar {
  @apply hidden sm:block flex-1 h-1 rounded-full overflow-hidden bg-neutral-200 dark:bg-white/10;
}

.usage-fill {
  @apply h-full rounded-full bg-neutral-400 dark:bg-white/40;
}

.tag-footer {
  @apply px-5 py-3 flex flex-row items-center gap-2;
  @apply border-t border-neutral-100 dark:border-white/10;
}

.empty {
  @apply flex flex-col items-center justify-center gap-2 py-10;
}

@media (hover: none) {
  .tag-name-button {
  @apply min-w-0 flex flex-row items-center rounded-md -mx-1.5 px-1.5 py-0.5 cursor-pointer;
  @apply hover:bg-neutral-200/70 dark:hover:bg-white/10 transition-colors;
}

.tag-name-button-active {
  @apply bg-neutral-200/70 dark:bg-white/10;
}

.preview-row {
  @apply w-full flex flex-row items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer;
  @apply hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors;
}

.row-actions { @apply opacity-100; }
}
</style>
