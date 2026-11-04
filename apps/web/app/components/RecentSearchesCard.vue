<template>
  <Teleport to="body">
    <Transition name="slide-up">
      <div
        v-show="isVisible"
        class="recent-searches-card"
        @mouseenter="emit('hover-change', true)"
        @mouseleave="emit('hover-change', false)"
        :style="cardStyle"
      >
        <div class="flex flex-col justify-between items-center gap-2 w-full">
          <div class="flex justify-between items-center mb-0 w-full">
            <h3 class="text-sm font-semibold opacity-60">
              {{ $t('search.recent_searches') }}
            </h3>
            <UButton
              variant="ghost"
              color="neutral"
              size="xs"
              class="opacity-50 hover:opacity-100"
              @click="clearRecentSearches"
            >
              {{ $t('search.clear_recent') }}
            </UButton>
          </div>

          <div class="flex flex-wrap gap-2">
            <TransitionGroup name="slide-up">
              <UBadge
                v-for="search in recentSearches.slice(0, 6)"
                :key="search"
                color="neutral"
                variant="solid"
                class="cursor-pointer"
                @click="selectRecentSearch(search)"
              >
                <div v-if="isColorSearch(search)" class="flex items-center gap-1 capitalize">
                  <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: getColorHex(getColorName(search)) }"></div>
                  {{ search.replace('color:', '') }}
                </div>
                <template v-else>
                  {{ search }}
                </template>
              </UBadge>
            </TransitionGroup>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStore } from '~/stores/myStore'

const props = defineProps({
  isExpanded: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['hover-change', 'close'])

const store = useStore()
const { recentSearches, searchValue, selectedTags, selectedColors } = storeToRefs(store)

/* The card belongs to the top bar. On a phone the field is docked at the
   bottom of the screen, where the card would cover the grid it is meant to
   help you search — so there it simply never opens. */
const isPhone = ref(false)

const updateIsPhone = () => {
  if (!process.client) return
  isPhone.value = window.matchMedia('(max-width: 768px)').matches
}

const shouldShow = computed(() => {
  if (isPhone.value) return false
  if (!props.isExpanded) return false
  if (recentSearches.value.length === 0) return false
  if (searchValue.value.trim() !== '') return false
  if (selectedTags.value.length > 0) return false
  if (selectedColors.value.length > 0) return false
  return true
})

const isVisible = ref(false)

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
  violet: '#EE82EE'
}

const anchorTop = ref(0)
const anchorLeft = ref(0)
const anchorWidth = ref(0)

const cardStyle = computed(() => {
  return {
    top: `${anchorTop.value}px`,
    left: `${anchorLeft.value}px`,
    width: `${anchorWidth.value}px`
  }
})

let rafId = 0
let resizeObserver

const updateAnchor = () => {
  if (!process.client) return
  const searchBar = document.getElementById('searchPill')
  if (!searchBar) return

  const rect = searchBar.getBoundingClientRect()
  const gap = 10
  const viewportPadding = 8
  const maxWidth = 600
  const extraWidth = 150

  // Centred on the field and wider than it, but never past the edges of the
  // screen: the card used to be shifted half of `extraWidth` to the left
  // unconditionally, which hung it off the left edge of a phone.
  const available = window.innerWidth - viewportPadding * 2
  const clampedWidth = Math.min(Math.max(240, rect.width + extraWidth), maxWidth, available)
  const centred = rect.left + (rect.width / 2) - (clampedWidth / 2)
  const left = Math.max(viewportPadding, Math.min(centred, window.innerWidth - clampedWidth - viewportPadding))

  anchorTop.value = Math.round(rect.bottom + gap)
  anchorLeft.value = Math.round(left)
  anchorWidth.value = Math.round(clampedWidth)
}

const scheduleAnchorUpdate = () => {
  if (!process.client) return
  if (rafId) return
  rafId = window.requestAnimationFrame(() => {
    rafId = 0
    if (isVisible.value) updateAnchor()
  })
}

onMounted(() => {
  updateIsPhone()
  scheduleAnchorUpdate()

  window.addEventListener('scroll', scheduleAnchorUpdate, { passive: true })
  window.addEventListener('resize', scheduleAnchorUpdate, { passive: true })
  window.addEventListener('resize', updateIsPhone, { passive: true })

  const searchBar = document.getElementById('searchPill')
  if (searchBar && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(scheduleAnchorUpdate)
    resizeObserver.observe(searchBar)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', scheduleAnchorUpdate)
  window.removeEventListener('resize', scheduleAnchorUpdate)
  window.removeEventListener('resize', updateIsPhone)
  if (resizeObserver) resizeObserver.disconnect()
  if (rafId) window.cancelAnimationFrame(rafId)
})

watch(
  shouldShow,
  (next) => {
    if (next) {
      updateAnchor()
      isVisible.value = true
      scheduleAnchorUpdate()
      return
    }

    isVisible.value = false
  },
  { flush: 'sync' }
)

const getColorHex = (colorName) => {
  return colorMap[colorName.toLowerCase()] || '#CCCCCC'
}

const isColorSearch = (search) => {
  return search.startsWith('color:')
}

const getColorName = (search) => {
  if (isColorSearch(search)) return search.replace('color:', '')
  return ''
}

const clearRecentSearches = () => {
  recentSearches.value = []
}

const selectRecentSearch = (search) => {
  if (search.startsWith('#')) {
    const tag = search.slice(1)
    selectedTags.value.push(tag)
  } else if (search.startsWith('color:')) {
    const colorName = search.replace('color:', '')
    const colorHex = getColorHex(colorName)

    selectedColors.value.push({
      name: colorName,
      hex: colorHex
    })
  } else {
    searchValue.value = search
  }

  emit('close')
}
</script>
