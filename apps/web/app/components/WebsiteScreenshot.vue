<template>
  <div
    class="relative w-full h-full overflow-auto"
    ref="fullPageScreenshotWrapper"
    @keydown="handleKeyboardShortcuts"
    @wheel="handleWheel"
    tabindex="0"
  >
    <div
      class="relative"
      :style="containerStyle"
      :class="{ 'cursor-grabbing': isPanning }"
      @mousedown="handlePanMouseDown"
    >
      <img
        @click="annotateImage"
        ref="fullPageScreenshot"
        @load="onImageLoad"
        class="w-full h-auto block shadow-2xl overflow-hidden rounded-xl ring ring-neutral-100"
        :src="screenshotUrl"
        alt=""
        loading="lazy"
      />

      <div class="absolute inset-0 -z-10">
        <nuxt-img
          format="webp"
          class="w-full h-full object-cover blur opacity-50"
          :src="screenshotUrl"
          alt=""
          quality="10"
          placeholder
        />
      </div>

      <ClientOnly>
        <TransitionGroup
          tag="div"
          class="absolute inset-0 pointer-events-none"
          :css="false"
          @before-enter="beforeEnter"
          @enter="enter"
          @leave="leave"
        >
          <div
            v-for="annotation in annotations"
            :key="annotation.id"
            class="absolute pointer-events-auto w-7 h-7"
            :style="getAnnotationStyle(annotation)"
            @mousedown="handleMouseDown($event, annotation)"
            @mousemove="handleMouseMove($event, annotation)"
            @mouseup="handleMouseUp($event, annotation)"
            @mouseover="hoveredAnnotationId = annotation.id"
            @mouseleave="hoveredAnnotationId = null"
          >
            <!-- Marker -->
            <div
              class="annotation-marker"
              :class="{
                'is-hovered': hoveredAnnotationId === annotation.id,
                'is-expanded': expandedAnnotationId === annotation.id
              }"
            >
                <UIcon
                  name="i-heroicons-ellipsis-horizontal"
                  class="w-5 h-5"
                />
            </div>

            <!-- Preview tooltip -->
            <Transition name="scale-top-left">
              <div
                v-if="hoveredAnnotationId === annotation.id && expandedAnnotationId !== annotation.id"
                class="annotation-preview"
              >
                {{ annotation.text.slice(0, 100) }}{{ annotation.text.length > 100 ? '...' : '' }}
              </div>
            </Transition>

            <!-- Full annotation card -->
             <Transition name="scale-top-left">
              <AnnotationCard
                v-if="expandedAnnotationId === annotation.id"
                class="-mt-6 ml-9"
                v-model="annotation.text"
                :is-hovered="true"
                @delete="confirmDelete(annotation)"
                @input="debouncedSaveAnnotation(annotation)"
                @close="expandedAnnotationId = null"
              />
            </Transition>
          </div>
        </TransitionGroup>
      </ClientOnly>
    </div>

    <!-- Zoom Controls -->
    <div class="fixed bottom-4 right-4 flex flex-col gap-2 items-end">
      <div class="flex gap-2">
        <UButton
          @click="zoomOut"
          :disabled="zoomLevel <= 0.5"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-minus"
        />
        <UButton
          @click="resetZoom"
          color="neutral"
          variant="soft"
        >
          {{ Math.round(zoomLevel * 100) }}%
        </UButton>
        <UButton
          @click="zoomIn"
          :disabled="zoomLevel >= 2"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-plus"
        />
      </div>
      <div
        v-if="zoomLevel > 1"
        class="text-xs opacity-60 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded"
      >
        {{ t('website_screenshot.pan_hint') }}
      </div>
    </div>

    <div class="fixed bottom-10 left-4 md:top-5 md:left-20 z-50 h-fit flex flex-col-reverse gap-2">
      <UDropdownMenu
        :items="[[
          {
            label: t('website_modal.annotations.delete.delete_all_label'),
            icon: 'i-heroicons-trash',
            onSelect: () => showDeleteAllModal = true
          }
        ]]"
      >
        <!-- {{isMobile ? 'blur' : 'ghost'}} -->
        <UButton
          :color="$colorMode.value == 'dark' ? 'black' : 'gray'"
          variant="ghost"
          :size="isMobile ? 'md' : 'xs'"
          icon="i-heroicons-ellipsis-vertical"
        />
      </UDropdownMenu>
      <UTooltip :text="t('website_screenshot.undo')">
        <UButton
          @click="undo"
          :disabled="!canUndo"
          :color="$colorMode.value == 'dark' ? 'black' : 'gray'"
          variant="ghost"
          :size="isMobile ? 'md' : 'xs'"
          icon="i-heroicons-arrow-uturn-left"
        />
          <!-- class="bg-neutral-100/80 dark:bg-neutral-900 backdrop-blur-md" -->
      </UTooltip>
      <UTooltip :text="t('website_screenshot.redo')">
        <UButton
          @click="redo"
          :disabled="!canRedo"
          :color="$colorMode.value == 'dark' ? 'black' : 'gray'"
          variant="ghost"
          :size="isMobile ? 'md' : 'xs'"
          icon="i-heroicons-arrow-uturn-right"
        />
      </UTooltip>
    </div>

    <UModal v-model:open="showDeleteModal">
  <template #content>
      <div class="p-4 max-w-md">
        <h3 class="text-lg font-medium mb-4">
          {{ t('website_modal.annotations.delete.title') }}
        </h3>
        <p class="opacity-80 mb-6">
          {{ t('website_modal.annotations.delete.message') }}
        </p>
        <div class="flex justify-end gap-3">
          <UButton
            @click="cancelDelete"
            variant="ghost"
          >
            {{ $t('common.cancel') }}
          </UButton>
          <UButton
            @click="handleDelete"
            color="red"
            variant="solid"
          >
            {{ $t('common.delete') }}
          </UButton>
        </div>
      </div>
    
  </template>
</UModal>

    <UModal v-model:open="showDeleteAllModal">
  <template #content>
      <div class="p-4 max-w-md">
        <h3 class="text-lg font-medium mb-4">
          {{ t('website_modal.annotations.delete.title') }}
        </h3>
        <p class="opacity-80 mb-6">
          {{ t('website_modal.annotations.delete.message') }}
        </p>
        <div class="flex justify-end gap-3">
          <UButton
            @click="cancelDeleteAll"
            variant="ghost"
          >
            {{ $t('common.cancel') }}
          </UButton>
          <UButton
            @click="deleteAllAnnotations"
            color="red"
            variant="solid"
          >
            {{ t('website_modal.annotations.delete.delete_all_title') }}
          </UButton>
        </div>
      </div>
    
  </template>
</UModal>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useEventListener, useThrottleFn, useRafFn } from '@vueuse/core'
import gsap from 'gsap'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()
const store = useStore()
const { webToShow, isMobile } = storeToRefs(store)
const { saveUpdatedSite, createDebounce } = store

// Watch for changes in webToShow.screenshotAnnotations
// watch(() => webToShow.value.screenshotAnnotations, (newVal) => {
//   annotations.value = newVal || []
// }, { deep: true })

// Refs
// Performance optimized refs using shallowRef
// Use shallowRef for better performance with large lists
const annotations = shallowRef([])
const fullPageScreenshot = shallowRef(null)

const debounce = createDebounce();

// Initialize annotations from webToShow
watch(() => webToShow.value.screenshotAnnotations, (newVal) => {
  annotations.value = newVal || []
}, { immediate: true })
const fullPageScreenshotWrapper = shallowRef(null)
const fullPageScreenshotObserver = shallowRef(null)
const fullPageScreenshotSize = shallowRef({ width: 0, height: 0 })
const isCommentBeingDragged = shallowRef(false)
const commentBeingDragged = shallowRef('')
const hoveredAnnotationId = shallowRef(null)
const expandedAnnotationId = shallowRef(null)
const zoomLevel = shallowRef(1)
const dragStartPosition = shallowRef({ x: 0, y: 0 })
const dragStartTime = shallowRef(0)
const isDragging = shallowRef(false)
const dragThreshold = 5

// Pan state
const isPanning = shallowRef(false)
const panOffset = shallowRef({ x: 0, y: 0 })
const panStartPosition = shallowRef({ x: 0, y: 0 })
const panStartOffset = shallowRef({ x: 0, y: 0 })

// Cache position during drag
// Optimized position cache during drag
const dragCache = shallowRef({
  x: 0,
  y: 0,
  transform: '',
  zIndex: 1
})

// History management
const history = ref([])
const currentHistoryIndex = ref(-1)
const maxHistorySize = 50

// Computed
// The full-page capture, never the cropped card thumbnail. Parse hands it back
// as a File (whose `url` is a method) on older rows and as a plain string on
// newer ones, and the search index carries only `fullPageScreenshotUrl`.
const screenshotUrl = computed(() => {
  const file = webToShow.value.fullPageScreenshot
  if (typeof file?.url === 'function') return file.url()
  if (typeof file?.url === 'string') return file.url
  if (typeof file === 'string') return file
  return webToShow.value.fullPageScreenshotUrl
})

const canUndo = computed(() => currentHistoryIndex.value > 0)
const canRedo = computed(() => currentHistoryIndex.value < history.value.length - 1)

// Methods

// Memoized computed properties
const containerStyle = computed(() => ({
  transform: `translate(${panOffset.value.x}px, ${panOffset.value.y}px) scale(${zoomLevel.value})`,
  transformOrigin: '0 0',
  transition: isPanning.value ? 'none' : 'transform 0.2s ease-out'
}))

const onImageLoad = (event) => {
  fullPageScreenshotSize.value = {
    width: event.target.width,
    height: event.target.height
  }

  fullPageScreenshotObserver.value = new ResizeObserver(entries => {
    for (let entry of entries) {
      const { width, height } = entry.contentRect
      fullPageScreenshotSize.value = { width, height }
    }
  })

  if (fullPageScreenshot.value) {
    fullPageScreenshotObserver.value.observe(fullPageScreenshot.value)
  }

  // Initialize history with current state
  addToHistory(webToShow.value.screenshotAnnotations || [])
}

const generateUniqueId = () => {
  return `annotation-${Date.now()}-${Math.random().toString(16).substr(2, 4)}`
}

const addToHistory = (newAnnotations) => {
  // Remove future history if we're in the middle of the history
  if (currentHistoryIndex.value < history.value.length - 1) {
    history.value = history.value.slice(0, currentHistoryIndex.value + 1)
  }

  // Add new state to history
  history.value.push(JSON.stringify(newAnnotations))
  currentHistoryIndex.value = history.value.length - 1

  // Trim history if it exceeds max size
  if (history.value.length > maxHistorySize) {
    const excess = history.value.length - maxHistorySize
    history.value = history.value.slice(excess)
    currentHistoryIndex.value = Math.max(0, currentHistoryIndex.value - excess)
  }

  // Update both local ref and store
  annotations.value = newAnnotations
  webToShow.value.screenshotAnnotations = newAnnotations
}

const saveAnnotation = (annotation) => {
  const existingAnnotation = webToShow.value.screenshotAnnotations?.find(a => a.id === annotation.id)
  if (existingAnnotation) {
    existingAnnotation.updatedAt = new Date().toISOString()
    existingAnnotation.text = annotation.text
    addToHistory(webToShow.value.screenshotAnnotations)
    saveUpdatedSite(
      webToShow.value.objectId,
      'screenshotAnnotations',
      webToShow.value.screenshotAnnotations
    )
  }
}

const debouncedSaveAnnotation = (annotation) => {
  debounce(() => saveAnnotation(annotation), 500)
}

// Pan handlers
const handlePanMouseDown = (event) => {
  // Only enable panning when zoomed in, using middle mouse button or space+click
  // Don't pan if clicking on an annotation
  if (event.target.closest('[class*="annotation"]')) {
    return
  }

  // Enable panning with middle mouse button (button 1) or Shift+left click
  const isPanTrigger = event.button === 1 || (event.button === 0 && event.shiftKey)

  if (!isPanTrigger) {
    return
  }

  event.preventDefault()
  isPanning.value = true
  panStartPosition.value = {
    x: event.clientX,
    y: event.clientY
  }
  panStartOffset.value = { ...panOffset.value }
}

const handlePanMouseMove = (event) => {
  if (!isPanning.value) return

  const deltaX = event.clientX - panStartPosition.value.x
  const deltaY = event.clientY - panStartPosition.value.y

  panOffset.value = {
    x: panStartOffset.value.x + deltaX,
    y: panStartOffset.value.y + deltaY
  }
}

const handlePanMouseUp = () => {
  isPanning.value = false
}

const handleWheel = (event) => {
  // Allow normal scrolling when not zoomed or when not holding shift
  // This enables vertical scrolling with mouse wheel
  if (zoomLevel.value <= 1 || !event.shiftKey) {
    return
  }

  // When zoomed and holding shift, prevent default scroll and pan instead
  event.preventDefault()

  panOffset.value = {
    x: panOffset.value.x - event.deltaX,
    y: panOffset.value.y - event.deltaY
  }
}

const handleMouseDown = (event, annotation) => {
  event.preventDefault()
  dragStartPosition.value = {
    x: event.clientX,
    y: event.clientY,
    initialX: annotation.x,
    initialY: annotation.y
  }
  dragStartTime.value = Date.now()
  isDragging.value = false
  isCommentBeingDragged.value = true
  commentBeingDragged.value = annotation.id
}

// Optimized style calculation with memoization
const styleCache = new Map()
const getAnnotationStyle = (annotation) => {
  const cacheKey = `${annotation.id}-${annotation.x}-${annotation.y}-${zoomLevel.value}`

  if (styleCache.has(cacheKey)) {
    return styleCache.get(cacheKey)
  }

  const isBeingDragged = isCommentBeingDragged.value && commentBeingDragged.value === annotation.id
  // Calculate if there's enough space on the right side
  const markerWidth = 28 // Width of marker in pixels
  const cardWidth = 268 // Approximate width of annotation card
  const screenWidth = fullPageScreenshot.value?.getBoundingClientRect().width || 0
  const positionX = (annotation.x / 100) * screenWidth

  // Check if there's enough space for the marker and card
  const spaceOnRight = screenWidth - positionX
  const shouldFlip = spaceOnRight < (cardWidth + markerWidth)

  const style = {
    left: `${annotation.x}%`,
    top: `${annotation.y}%`,
    transform: `scale3d(${1/zoomLevel.value}, ${1/zoomLevel.value}, 1)`,
    zIndex: isBeingDragged ? 50 : 1,
    position: 'absolute',
    transformOrigin: '0 0',
    willChange: isBeingDragged ? 'transform' : 'auto',
    backfaceVisibility: 'hidden',
    perspective: 1000,
    '-webkit-font-smoothing': 'antialiased',
    '--is-flipped': shouldFlip ? '1' : '0'
  }

  styleCache.set(cacheKey, style)
  return style
}

// Optimized RAF handling
const { pause: pauseRaf, resume: resumeRaf } = useRafFn(() => {
  if (!isDragging.value || !dragCache.value) return

  const annotation = annotations.value.find(a => a.id === commentBeingDragged.value)
  if (!annotation) return

  const rect = fullPageScreenshot.value.getBoundingClientRect()

  annotation.x = Math.max(0, Math.min(100, dragCache.value.x))
  annotation.y = Math.max(0, Math.min(100, dragCache.value.y))

  // Clear cache for this annotation to force style recalculation
  styleCache.delete(`${annotation.id}-${annotation.x}-${annotation.y}-${zoomLevel.value}`)
}, { immediate: false })

const handleMouseMove = useThrottleFn((event, annotation) => {
  if (!isCommentBeingDragged.value || commentBeingDragged.value !== annotation.id) return

  // Calculate deltas only if not already dragging
  if (!isDragging.value) {
    const deltaX = Math.abs(event.clientX - dragStartPosition.value.x)
    const deltaY = Math.abs(event.clientY - dragStartPosition.value.y)

    if (deltaX > dragThreshold || deltaY > dragThreshold) {
      isDragging.value = true
      resumeRaf()
    } else {
      return // Exit early if threshold not met
    }
  }

  // Only calculate rect and update cache if dragging
  const rect = fullPageScreenshot.value.getBoundingClientRect()
  dragCache.value = {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100
  }
}, 8)

const handleMouseUp = (event, annotation) => {
  const dragDuration = Date.now() - dragStartTime.value

  if (isCommentBeingDragged.value) {
    isCommentBeingDragged.value = false
    commentBeingDragged.value = ''

    if (isDragging.value) {
      debouncedSaveAnnotation(annotation)
      styleCache.clear() // Clear cache after drag
    } else if (dragDuration < 200) { // Click detection
      // Toggle expanded state
      expandedAnnotationId.value = expandedAnnotationId.value === annotation.id ? null : annotation.id
    }

    isDragging.value = false
    pauseRaf()
  }
}

const annotateImage = (event) => {
  // Prevent if clicking on an existing annotation or if we just finished panning
  if (event.target.closest('.annotation-card') || isPanning.value || event.shiftKey) {
    return
  }

  if (!webToShow.value.screenshotAnnotations) {
    webToShow.value.screenshotAnnotations = []
  }

  const rect = fullPageScreenshot.value.getBoundingClientRect()
  // Calculate position considering annotation card width and the current zoom level
  // Calculate percentages
  const x = ((event.clientX - rect.left) / rect.width) * 100
  const y = ((event.clientY - rect.top) / rect.height) * 100

  // Ensure the annotation stays within bounds, allowing full width
  const maxX = 100

  const newAnnotation = {
    id: generateUniqueId(),
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(100, y)),
    text: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const newAnnotations = [...(webToShow.value.screenshotAnnotations || []), newAnnotation]
  webToShow.value.screenshotAnnotations = newAnnotations
  annotations.value = newAnnotations
  addToHistory(newAnnotations)
  saveUpdatedSite(
    webToShow.value.objectId,
    'screenshotAnnotations',
    newAnnotations
  )
}

// Delete handling
const showDeleteModal = ref(false)
const annotationToDelete = ref(null)
const showDeleteAllModal = ref(false)

const confirmDelete = (annotation) => {
  annotationToDelete.value = annotation
  showDeleteModal.value = true
}

const handleDelete = () => {
  if (annotationToDelete.value) {
    const index = webToShow.value.screenshotAnnotations.findIndex(a => a.id === annotationToDelete.value.id)
    if (index !== -1) {
      webToShow.value.screenshotAnnotations.splice(index, 1)
      addToHistory(webToShow.value.screenshotAnnotations)
      saveUpdatedSite(
        webToShow.value.objectId,
        'screenshotAnnotations',
        webToShow.value.screenshotAnnotations
      )
    }
  }
  showDeleteModal.value = false
  annotationToDelete.value = null
}

const cancelDelete = () => {
  showDeleteModal.value = false
  annotationToDelete.value = null
}

const deleteAllAnnotations = () => {
  webToShow.value.screenshotAnnotations = []
  addToHistory([])
  saveUpdatedSite(
    webToShow.value.objectId,
    'screenshotAnnotations',
    []
  )
  showDeleteAllModal.value = false
}

const cancelDeleteAll = () => {
  showDeleteAllModal.value = false
}

// Zoom controls
const zoomIn = () => {
  zoomLevel.value = Math.min(2, zoomLevel.value + 0.1)
}

const zoomOut = () => {
  zoomLevel.value = Math.max(0.5, zoomLevel.value - 0.1)
}

const resetZoom = () => {
  zoomLevel.value = 1
  panOffset.value = { x: 0, y: 0 }
}

// History controls
const undo = () => {
  if (canUndo.value) {
    currentHistoryIndex.value--
    const newAnnotations = JSON.parse(history.value[currentHistoryIndex.value])
    annotations.value = newAnnotations
    webToShow.value.screenshotAnnotations = newAnnotations
    saveUpdatedSite(
      webToShow.value.objectId,
      'screenshotAnnotations',
      newAnnotations
    )
  }
}

const redo = () => {
  if (canRedo.value) {
    currentHistoryIndex.value++
    const newAnnotations = JSON.parse(history.value[currentHistoryIndex.value])
    annotations.value = newAnnotations
    webToShow.value.screenshotAnnotations = newAnnotations
    saveUpdatedSite(
      webToShow.value.objectId,
      'screenshotAnnotations',
      newAnnotations
    )
  }
}

// Keyboard shortcuts
const handleKeyboardShortcuts = (e) => {
  if (e.key === 'Escape' && expandedAnnotationId.value) {
    e.stopPropagation()
    expandedAnnotationId.value = null
    return
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') {
      e.preventDefault()
      if (e.shiftKey) {
        redo()
      } else {
        undo()
      }
    } else if (e.key === 'y') {
      e.preventDefault()
      redo()
    }
  }
}

// Handle document-level mouse events
const handleDocumentMouseMove = (e) => {
  // Handle panning
  if (isPanning.value) {
    handlePanMouseMove(e)
    return
  }

  // Handle annotation dragging
  if (isCommentBeingDragged.value && webToShow.value?.screenshotAnnotations) {
    const annotation = webToShow.value.screenshotAnnotations.find(
      a => a.id === commentBeingDragged.value
    )
    if (annotation) {
      handleMouseMove(e, annotation)
    }
  }
}

const handleDocumentMouseUp = () => {
  // Handle pan end
  if (isPanning.value) {
    handlePanMouseUp()
    return
  }

  // Handle annotation drag end
  if (isCommentBeingDragged.value && webToShow.value?.screenshotAnnotations) {
    const annotation = webToShow.value.screenshotAnnotations.find(
      a => a.id === commentBeingDragged.value
    )
    if (annotation) {
      handleMouseUp(annotation)
    }
  }
}

// Lifecycle
onMounted(() => {
  fullPageScreenshotWrapper.value?.focus()
  document.addEventListener('mousemove', handleDocumentMouseMove)
  document.addEventListener('mouseup', handleDocumentMouseUp)
})

onBeforeUnmount(() => {
  if (fullPageScreenshotObserver.value) {
    fullPageScreenshotObserver.value.disconnect()
  }
  pauseRaf()
  styleCache.clear()
  document.removeEventListener('mousemove', handleDocumentMouseMove)
  document.removeEventListener('mouseup', handleDocumentMouseUp)
})

// Animation methods
const beforeEnter = (el) => {
  gsap.set(el, {
    opacity: 0,
    scale: 0.8,
    transformOrigin: 'center'
  })
}

const enter = (el, done) => {
  gsap.to(el, {
    opacity: 1,
    scale: 1,
    duration: 0.3,
    ease: 'back.out(1.7)',
    onComplete: done
  })
}

const leave = (el, done) => {
  gsap.to(el, {
    opacity: 0,
    scale: 0.8,
    duration: 0.2,
    ease: 'power2.in',
    onComplete: done
  })
}


</script>

<style scoped>
@reference "../assets/css/tailwind.css";
.annotation-marker {
  @apply
    w-7 h-7
    rounded-2xl
    bg-green-600
    text-white
    flex items-center justify-center
    text-xs
    cursor-pointer
    shadow-sm
    transition-all duration-200 ease-in-out
  ;
  border-top-left-radius: 2px;
  /* border-top-left-radius: calc(var(--is-flipped, 0) * 14px + 2px); */
  /* border-top-right-radius: calc((1 - var(--is-flipped, 0)) * 14px + 2px); */
}

.annotation-marker.is-hovered {
  @apply bg-green-500 z-[100] scale-110;
}

.annotation-marker.is-expanded {
  @apply bg-green-600 z-[100];
}

.annotation-preview {
  @apply
    absolute
    top-0
    bg-white dark:bg-neutral-700
    border border-neutral-100 dark:border-neutral-600
    px-3 py-2
    rounded-md
    shadow-lg
    text-sm
    max-w-sm
    pointer-events-none
    z-[100]
  ;
  left: calc(var(--is-flipped, 0) * -100% + (1 - var(--is-flipped, 0)) * 2rem);
}
</style>
