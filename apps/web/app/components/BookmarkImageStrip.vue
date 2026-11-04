<template>
  <div v-if="items.length > 1" class="image-strip">
    <div class="image-strip-rail" role="listbox" :aria-label="$t('bookmarks.image_order')">
      <button
        v-for="(image, index) in items"
        :key="image.id"
        type="button"
        role="option"
        class="image-strip-thumb"
        :class="{ 'is-current': index === current, 'is-dragging': dragIndex === index, 'is-over': overIndex === index && dragIndex !== index }"
        :aria-selected="index === current"
        :aria-label="$t('bookmarks.image_n_of_m', { n: index + 1, m: items.length })"
        draggable="true"
        @click="$emit('select', index)"
        @dragstart="onDragStart(index, $event)"
        @dragover.prevent="overIndex = index"
        @dragleave="overIndex === index && (overIndex = null)"
        @drop.prevent="onDrop(index)"
        @dragend="onDragEnd"
        @keydown.left.exact.prevent="move(index, index - 1)"
        @keydown.right.exact.prevent="move(index, index + 1)"
      >
        <img :src="image.url" alt="" loading="lazy" />
        <span v-if="index === 0" class="image-strip-cover">{{ $t('bookmarks.cover') }}</span>
      </button>
    </div>

    <p class="image-strip-hint">{{ $t('bookmarks.reorder_hint') }}</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  /** The bookmark's images, in display order. */
  modelValue: { type: Array, required: true },
  current: { type: Number, default: 0 },
})

const emit = defineEmits(['update:modelValue', 'select'])

const items = computed(() => props.modelValue || [])

// Native HTML5 drag-and-drop, matching the pattern the bookmark cards already
// use. No library: this is a handful of thumbnails, and the one drag dependency
// in package.json is registered but unused everywhere else.
const dragIndex = ref(null)
const overIndex = ref(null)

function onDragStart(index, event) {
  dragIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  // Firefox refuses to start a drag without payload.
  event.dataTransfer.setData('text/plain', String(index))
}

function onDrop(index) {
  if (dragIndex.value !== null) move(dragIndex.value, index)
  onDragEnd()
}

function onDragEnd() {
  dragIndex.value = null
  overIndex.value = null
}

/**
 * Moving the first thumbnail changes the cover, which the backend mirrors onto
 * OGImage — so this also changes what the grid shows.
 */
function move(from, to) {
  if (to < 0 || to >= items.value.length || from === to) return
  const next = [...items.value]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  emit('update:modelValue', next)
  emit('select', to)
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.image-strip {
  @apply flex flex-col gap-1 w-full;
}

.image-strip-rail {
  @apply flex gap-2 overflow-x-auto py-2 px-1;
  scrollbar-width: thin;
}

.image-strip-thumb {
  @apply relative shrink-0 w-16 h-16 rounded-lg overflow-hidden cursor-grab;
  @apply ring-2 ring-transparent transition-all duration-150;

  img {
    @apply w-full h-full object-cover pointer-events-none;
  }

  &:hover { @apply ring-neutral-300 dark:ring-neutral-600; }
  &:focus-visible { @apply outline-none ring-primary-500; }
  &.is-current { @apply ring-primary-500; }
  &.is-dragging { @apply opacity-40 cursor-grabbing; }
  &.is-over { @apply ring-primary-400 scale-105; }
}

.image-strip-cover {
  @apply absolute bottom-0 inset-x-0 text-[9px] leading-4 text-center;
  @apply bg-black/60 text-white uppercase tracking-wide;
}

.image-strip-hint {
  @apply text-xs text-neutral-400 dark:text-neutral-500 px-1;
}
</style>
