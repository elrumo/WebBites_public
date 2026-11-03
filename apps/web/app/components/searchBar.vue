<template>
  <div class="">
    <div
      class="w-full min-w-0 flex gap-3 md:gap-1 justify-center items-center transition-all duration-1000"
      @click.stop
    >
      <!-- The pill is the field: icon, filter chips, the input and the
           controls are siblings in one flex row, so the typed text always keeps
           its own room (the chips used to sit over the input and cover it).
           On a laptop the pill widens to fit its chips, up to a limit; past
           that the ones that do not fit collapse into "+n". -->
      <div
        id="searchPill"
        ref="pillEl"
        class="search-bar-input glow-input-ring ai-input-ring flex items-center gap-1.5 px-3 min-h-[42px]"
        :class="{
          'glow-input-ring--active': isSearching,
          'ai-input-ring--active': useEmbeddings && !isSearching
        }"
        :style="pillWidth ? { width: pillWidth + 'px' } : null"
        @click="focusInput"
      >
        <UIcon name="i-heroicons-magnifying-glass-20-solid" class="size-5 shrink-0 text-gray-400 pointer-events-none"/>

        <SearchFilterChip
          v-for="f in visibleFilters"
          :key="f.key"
          :filter="f"
          @remove="removeFilter(f)"
        />

        <UPopover v-if="hiddenFilters.length">
          <button type="button" class="search-more" @click.stop>+{{ hiddenFilters.length }}</button>
          <template #content>
            <div class="flex max-w-80 flex-wrap gap-1.5 p-2">
              <SearchFilterChip
                v-for="f in hiddenFilters"
                :key="f.key"
                :filter="f"
                @remove="removeFilter(f)"
              />
            </div>
          </template>
        </UPopover>

        <UInput
          v-model="searchValue"
          name="searchValue"
          variant="none"
          :placeholder="filters.length ? '' : $t('common.search')"
          class="min-w-[6rem] flex-1"
          size="md"
          ref="searchBar"
          @keydown.backspace="removeLastTag"
          @keydown.escape="showCommandBar = false"
          @focus="handleFocus"
          @blur="handleBlur"
          :ui="{ root: 'w-full', base: 'px-0' }"
        />

        <Transition name="slide-in-right" mode="out-in">
          <div v-if="searchValue !== '' || filters.length" class="inline-flex shrink-0">
            <UButton
              icon="i-heroicons-x-mark-20-solid"
              color="neutral"
              variant="link"
              class="p-0"
              @mousedown.prevent="clearSearch"
            />
          </div>
          <div v-else class="hidden shrink-0 items-center gap-0.5 sm:inline-flex">
            <UKbd value="meta" size="sm" />
            <UKbd value="K" size="sm" />
          </div>
        </Transition>

        <UPopover @update:open="onFiltersOpen">
          <UChip :show="useEmbeddings" text="" size="sm" class="shrink-0">
            <UButton
              icon="i-heroicons-adjustments-horizontal"
              variant="ghost"
              class="-mr-1.5 rounded-full"
              :aria-label="$t('search_bar.filters')"
              square
            />
          </UChip>

          <template #content>
            <div class="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3">
              <div class="flex items-start gap-3">
                <div class="flex flex-col items-start gap-[2px]">
                  <p class="text-sm opacity-90">
                    {{ $t('plans.features.natural_language_search') }} <span class="text-xs opacity-60">{{ $t('search_bar.beta') }}</span>
                  </p>
                  <small class="w-full pt-1 opacity-70">
                    {{ $t('search_bar.natural_language_description') }}
                    <i>{{ $t('search_bar.natural_language_example') }}</i>
                  </small>
                </div>
                <USwitch v-model="useEmbeddings" />
              </div>

              <USeparator />

              <div class="flex flex-col gap-2">
                <p class="text-xs font-medium uppercase tracking-wide opacity-50">{{ $t('search_bar.colors') }}</p>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="(hex, name) in colorMap"
                    :key="name"
                    type="button"
                    :title="$t(`search_bar.color_names.${name}`)"
                    :aria-label="$t(`search_bar.color_names.${name}`)"
                    :aria-pressed="hasColor(name)"
                    class="size-6 rounded-full ring-1 ring-inset ring-black/15 transition-transform active:scale-90 dark:ring-white/25"
                    :class="hasColor(name) ? 'outline outline-2 outline-offset-2 outline-primary' : ''"
                    :style="{ backgroundColor: hex }"
                    @click="toggleColor(name)"
                  />
                </div>
              </div>

              <USeparator />

              <div class="flex flex-col gap-2">
                <p class="text-xs font-medium uppercase tracking-wide opacity-50">{{ $t('bookmark_details.tags') }}</p>
                <UInput
                  v-model="tagQuery"
                  size="sm"
                  icon="i-heroicons-hashtag"
                  :placeholder="$t('search_bar.find_tag')"
                />
                <div class="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  <button
                    v-for="tag in tagItems"
                    :key="tag.name"
                    type="button"
                    class="tag-option"
                    :class="{ 'tag-option--on': hasTag(tag.name) }"
                    @click="toggleTag(tag.name)"
                  >
                    #{{ tag.name }}<span v-if="tag.count" class="ml-1 opacity-50">{{ tag.count }}</span>
                  </button>
                  <p v-if="!tagItems.length" class="text-xs opacity-50">
                    {{ tagsLoading ? $t('search_bar.tags_loading') : $t('search_bar.no_tags') }}
                  </p>
                </div>
              </div>
            </div>
          </template>
        </UPopover>

        <!-- Measures the chips at their natural width so the layout above
             knows how many fit. Never seen, never focusable. -->
        <div ref="measureEl" aria-hidden="true" class="pointer-events-none invisible absolute left-0 top-0 flex h-0 gap-1.5 overflow-hidden">
          <SearchFilterChip v-for="f in filters" :key="f.key" :filter="f" />
        </div>
      </div>

      <RecentSearchesCard
        :is-expanded="isExpanded"
        @hover-change="isCardHovered = $event"
        @close="isFocused = false; isCardHovered = false"
      />

      <NewBookmark :isOnHeader="true "/>
    </div>
  </div>
</template>

<script setup>
import { useStore } from '~/stores/myStore'
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { watchDebounced } from '@vueuse/core'

const store = useStore()
const { 
  searchSites, 
  createDebounce
 } = store

const {
  selectedTags,
  selectedColors,
  searchValue,
  useEmbeddings,
  isSearching
} = storeToRefs(store)


const searchBar = ref(null)
const isFocused = ref(false)
const isCardHovered = ref(false)
const showCommandBar = ref(false)
const debounce = ref(createDebounce());

// Focus the search input on ⌘K / Ctrl+K
defineShortcuts({
  meta_k: () => {
    searchBar.value?.inputRef?.focus()
  }
})

// Color mapping object
const colorMap = {
  red: '#FF0000',
  green: '#00FF00',
  blue: '#0000FF',
  yellow: '#FFFF00',
  purple: '#800080',
  orange: '#FFA500',
  black: '#000000',
  white: '#FFFFFF',
  pink: '#FFC0CB',
  brown: '#A52A2A',
  gray: '#808080',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  lime: '#00FF00',
  olive: '#808000',
  navy: '#000080',
  teal: '#008080',
  maroon: '#800000',
  silver: '#C0C0C0',
  gold: '#FFD700',
  indigo: '#4B0082',
  violet: '#EE82EE',
  // Add more colors as needed
}

const isExpanded = computed(() => {
  return isFocused.value || isCardHovered.value
})

// Watch searchValue
watch([searchValue, useEmbeddings], (oldVal, newVal) => {
  const searchChanged = oldVal[0] !== newVal[0]
  const embedChanged = oldVal[1] !== newVal[1] && (oldVal[0] || newVal[0])
  
  // Skip if values haven't actually changed (e.g. initial load)
  if (!searchChanged && !embedChanged) return;

  // let ms = (searchChanged && !embedChanged) ? 100 : 0
  let ms = searchValue.value.trim() === '' ? 0 : 200;

  checkForTags()
  checkForColors()
  debounce.value(() => searchSites(searchValue.value), ms)
})


// Watch selectedTags and selectedColors
watch([selectedTags, selectedColors], (newVal, oldVal) => {
  // Check if arrays are actually different to prevent redundant calls
  const tagsChanged = JSON.stringify(newVal[0]) !== JSON.stringify(oldVal?.[0]);
  const colorsChanged = JSON.stringify(newVal[1]) !== JSON.stringify(oldVal?.[1]);

  if (!tagsChanged && !colorsChanged) return;

  debounce.value(() => searchSites(searchValue.value), 100)
}, { deep: true })

// --- Filter chips: fit, widen, collapse into "+n" ---------------------------
const filters = computed(() => [
  ...selectedTags.value.map(t => ({ key: `t:${t}`, kind: 'tag', label: t })),
  ...selectedColors.value.map(c => ({ key: `c:${c.name}`, kind: 'color', label: c.name, hex: c.hex }))
])

const pillEl = ref(null)
const measureEl = ref(null)
const pillWidth = ref(0) // px on a laptop; 0 on a phone, where the row sets the width
const visibleCount = ref(0)
const visibleFilters = computed(() => filters.value.slice(0, visibleCount.value))
const hiddenFilters = computed(() => filters.value.slice(visibleCount.value))

const BASE_WIDTH = 512 // the bar's resting width
const MAX_WIDTH = 880 // how far it may grow for chips before they collapse
const CHROME = 130 // icon, padding, clear/⌘K and the filters button
const MIN_INPUT = 120 // room the typed text always keeps
const MORE = 48 // the "+n" button
const GAP = 6

const layoutFilters = () => {
  if (!pillEl.value || !measureEl.value) return
  const widths = [...measureEl.value.children].map(el => el.offsetWidth)
  const total = widths.reduce((sum, w) => sum + w + GAP, 0)
  const desktop = window.matchMedia('(min-width: 769px)').matches

  let target
  if (desktop) {
    // Stay clear of whatever sits either side of the centred bar.
    const wrap = pillEl.value.closest('.search-wrapper')
    const side = Math.max(
      wrap?.querySelector('.top-bar-actions')?.offsetWidth ?? 0,
      wrap?.firstElementChild?.offsetWidth ?? 0
    )
    const room = wrap ? wrap.clientWidth - 2 * (side + 16) - 72 : MAX_WIDTH
    const cap = Math.max(BASE_WIDTH, Math.min(MAX_WIDTH, room))
    target = Math.min(cap, Math.max(BASE_WIDTH, total + CHROME + MIN_INPUT))
    pillWidth.value = target
  } else {
    pillWidth.value = 0
    target = pillEl.value.clientWidth
  }

  const room = target - CHROME - MIN_INPUT
  if (total <= room) {
    visibleCount.value = widths.length
    return
  }
  let used = MORE + GAP, count = 0
  for (const w of widths) {
    if (used + w + GAP > room) break
    used += w + GAP
    count++
  }
  visibleCount.value = count
}

let layoutRaf = 0
const scheduleLayout = () => {
  cancelAnimationFrame(layoutRaf)
  layoutRaf = requestAnimationFrame(layoutFilters)
}

watch(filters, async () => {
  await nextTick()
  layoutFilters()
}, { flush: 'post' })

let pillObserver
onMounted(() => {
  layoutFilters()
  window.addEventListener('resize', scheduleLayout, { passive: true })
  // The row can change under us (side panels open); a phone's pill follows it.
  pillObserver = new ResizeObserver(scheduleLayout)
  pillObserver.observe(pillEl.value.closest('.search-wrapper') ?? pillEl.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleLayout)
  pillObserver?.disconnect()
  cancelAnimationFrame(layoutRaf)
})

const removeFilter = (f) => f.kind === 'tag' ? removeTag(f.label) : removeColor(f.label)
const focusInput = () => searchBar.value?.inputRef?.focus()

// --- Filters popover: add tags and colours without typing the syntax --------
const { list: listTags } = useTags()
const tagItems = ref([])
const tagQuery = ref('')
const tagsLoading = ref(false)

const loadTags = async () => {
  tagsLoading.value = true
  try {
    const res = await listTags(tagQuery.value, 0)
    tagItems.value = res?.tags || []
  } catch {
    tagItems.value = [] // signed out or offline
  } finally {
    tagsLoading.value = false
  }
}
watchDebounced(tagQuery, loadTags, { debounce: 200 })
const onFiltersOpen = (open) => { if (open) loadTags() }

const hasTag = (name) => selectedTags.value.some(t => t.toLowerCase() === name.toLowerCase())
const toggleTag = (name) => {
  selectedTags.value = hasTag(name)
    ? selectedTags.value.filter(t => t.toLowerCase() !== name.toLowerCase())
    : [...selectedTags.value, name]
}
const hasColor = (name) => selectedColors.value.some(c => c.name === name)
const toggleColor = (name) => {
  selectedColors.value = hasColor(name)
    ? selectedColors.value.filter(c => c.name !== name)
    : [...selectedColors.value, { name, hex: colorMap[name] }]
}

const handleFocus = () => {
  isFocused.value = true
}

const handleBlur = (event) => {
  // Only set isFocused to false if we're not hovering over the card
  if (!isCardHovered.value) {
    isFocused.value = false
  }
}

const checkForTags = () => {
  // Support both #tag and tag:tag syntax
  if ((searchValue.value.includes('#') || searchValue.value.includes('tag:')) && searchValue.value.includes(' ')) {
    let tag = ''
    let tagPrefix = ''
    
    if (searchValue.value.includes('#')) {
      const tagPart = searchValue.value.split('#')[1]
      tag = tagPart.split(' ')[0]
      tagPrefix = '#'
    } else if (searchValue.value.includes('tag:')) {
      const tagPart = searchValue.value.split('tag:')[1]
      tag = tagPart.split(' ')[0]
      tagPrefix = 'tag:'
    }

    console.log('tag: ', tag)

    if (tag) {
      // Convert tag to lowercase for case-insensitive comparison
      const normalizedTag = tag.toLowerCase()

      // Check if tag already exists (case-insensitive)
      const tagExists = selectedTags.value.some(
        existingTag => existingTag.toLowerCase() === normalizedTag
      )

      // Only add tag if it doesn't already exist
      if (!tagExists) {
        selectedTags.value.push(tag)
        searchValue.value = searchValue.value.replace(`${tagPrefix}${tag}`, '').trim()
      } else {
        // Just remove the duplicate tag from input without adding it
        searchValue.value = searchValue.value.replace(`${tagPrefix}${tag}`, '').trim()
      }
    }
  }
}

const checkForColors = () => {
  if (searchValue.value.includes('color:') && searchValue.value.includes(' ')) {
    const colorPart = searchValue.value.split('color:')[1]
    const colorName = colorPart.split(' ')[0]

    if (colorName) {
      // Convert colorName to lowercase for case-insensitive comparison
      const normalizedColorName = colorName.toLowerCase()
      
      // Check if color exists in our map
      const colorHex = getColorHex(normalizedColorName)
      
      if (colorHex) {
        // Check if color already exists
        const colorExists = selectedColors.value.some(
          existingColor => existingColor.name.toLowerCase() === normalizedColorName
        )

        // Only add color if it doesn't already exist
        if (!colorExists) {
          selectedColors.value.push({
            name: normalizedColorName,
            hex: colorHex
          })
          searchValue.value = searchValue.value.replace(`color:${colorName}`, '').trim()
        } else {
          // Just remove the duplicate color from input without adding it
          searchValue.value = searchValue.value.replace(`color:${colorName}`, '').trim()
        }
      }
    }
  }
}

const getColorHex = (colorName) => {
// Return hex code if the color exists in our map, otherwise return a default
return colorMap[colorName.toLowerCase()] || '#CCCCCC'
}

const removeTag = (tag) => {
  selectedTags.value = selectedTags.value.filter(t => t !== tag)
}

const removeColor = (colorName) => {
selectedColors.value = selectedColors.value.filter(c => c.name !== colorName)
}

const removeLastTag = () => {
if (searchValue.value === '') {
  if (selectedColors.value.length > 0) {
    selectedColors.value.pop()
  } else if (selectedTags.value.length > 0) {
    selectedTags.value.pop()
  }
}
}

const clearSearch = () => {
  searchValue.value = ''
  selectedTags.value = []
  selectedColors.value = []
}

</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.search-bar-input{
  /* Eases the pill wider as chips arrive; transition-all on it already covers
     the shadow and ring. */
  transition-property: width, box-shadow, background-color;
  transition-duration: 300ms;
}

.search-more{
  @apply
    inline-flex shrink-0 items-center justify-center
    h-[30px] px-2.5 rounded-full
    text-sm font-medium leading-none tabular-nums
    bg-white text-neutral-600 hover:text-neutral-900
    dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white
    transition-colors
  ;

  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
}

.tag-option{
  @apply
    inline-flex items-center h-7 px-2.5 rounded-full
    text-sm font-medium leading-none whitespace-nowrap
    bg-neutral-100 text-neutral-600 hover:bg-neutral-200
    dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700
    transition-colors active:scale-95
  ;
}

.tag-option--on{
  @apply bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200;
}
</style>
