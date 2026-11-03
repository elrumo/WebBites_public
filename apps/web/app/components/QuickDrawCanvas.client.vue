<template>
  <div class="quickdraw-canvas" :class="{ 'is-readonly': readonly }">
    <div ref="host" class="quickdraw-host"></div>

    <div v-if="tainted" class="quickdraw-tainted-note">
      {{ $t('bookmarks.drawing.assets_unavailable') }}
    </div>
  </div>
</template>

<script setup>
/**
 * The Quickdraw board itself — a thin wrapper around @quickdrawjs/core.
 *
 * Client-only (`.client.vue`) because the engine reaches for `document` at construction
 * time, and lazy at the call site for the same reason <LazyTiptap> is: the bundle is
 * ~25kB gzipped and most sessions never open a drawing.
 *
 * Two things worth knowing before editing this file:
 *
 * 1. `createQuickdraw` takes no `snapshot` option (its options are the Editor's plus
 *    `hideUi`/`onSave`/`watermark`). Loading a board is a separate
 *    `editor.store.loadSnapshot()` call after construction.
 *
 * 2. The store this component holds is always in *editing* form — image assets carry
 *    data URLs. See `useDrawingAssets` for why that is a correctness requirement rather
 *    than a preference. Everything that leaves this component is dehydrated first.
 */
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { createQuickdraw } from '@quickdrawjs/core'
import '@quickdrawjs/core/quickdraw.css'
import {
  hydrateSnapshot,
  dehydrateSnapshot,
  uploadDrawingAsset,
  emptyDrawingSnapshot,
  blobToDataUrl,
} from '~/composables/useDrawingAssets'

const props = defineProps({
  modelValue: { type: Object, default: null },
  readonly: { type: Boolean, default: false },
  /** Milliseconds of quiet before a change is published upward. */
  debounceMs: { type: Number, default: 800 },
})

const emit = defineEmits(['update:modelValue', 'thumbnail', 'ready', 'dirty'])

const host = ref(null)
const instance = shallowRef(null)
const tainted = ref(false)
const dirty = ref(false)

/** assetId -> bucket URL, so an image is uploaded once and not once per keystroke. */
let assetCache = new Map()
let unlisten = null
let debounceTimer = null
/** Suppresses the change handler while we load a snapshot into the store ourselves. */
let loading = false
/** The last snapshot we emitted, so our own echo does not trigger a reload. */
let lastPublished = null

const colorMode = useColorMode()
const themeId = () => (colorMode?.value === 'dark' ? 'dark' : 'light')

// ─── lifecycle ────────────────────────────────────────────────────────

onMounted(async () => {
  const { snapshot, cache, tainted: couldNotInline } = await hydrateSnapshot(props.modelValue)
  assetCache = cache
  tainted.value = couldNotInline

  await nextTick()
  if (!host.value) return

  const qd = createQuickdraw({
    container: host.value,
    theme: themeId(),
    grid: 'dots',
    readonly: props.readonly,
    hideUi: props.readonly,
    watermark: false,
  })

  instance.value = qd

  loading = true
  qd.editor.store.loadSnapshot(snapshot, 'remote')
  loading = false

  if (!props.readonly) {
    unlisten = qd.editor.store.listen(onStoreChange, { source: 'user' })
  }

  emit('ready')
})

onBeforeUnmount(async () => {
  clearTimeout(debounceTimer)
  unlisten?.()

  // A board closed mid-edit still owes its parent a final snapshot and a fresh
  // thumbnail; publish before we tear the editor down, since commit() needs it alive.
  if (dirty.value) {
    try { await commit() } catch (err) { console.error('[drawing] final commit failed:', err) }
  }

  instance.value?.destroy()
  instance.value = null
})

// ─── change plumbing ──────────────────────────────────────────────────

function onStoreChange() {
  if (loading) return
  dirty.value = true
  emit('dirty')

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(publishSnapshot, props.debounceMs)
}

/**
 * Publish the document. Cheap enough to run on every pause in drawing: it is JSON,
 * and any image upload inside it happens at most once per image.
 */
async function publishSnapshot() {
  const editor = instance.value?.editor
  if (!editor) return null

  const drawing = await dehydrateSnapshot(editor.store.getSnapshot(), assetCache)
  lastPublished = drawing
  emit('update:modelValue', drawing)
  return drawing
}

/**
 * Flush everything the parent needs to write a row: the dehydrated snapshot and a
 * freshly exported thumbnail.
 *
 * The thumbnail is deliberately *not* regenerated on every autosave tick — each export
 * uploads a new Parse.File and orphans the previous one, so it is produced on explicit
 * saves and on close instead, where it is one file per editing session.
 */
async function commit() {
  clearTimeout(debounceTimer)

  const drawing = await publishSnapshot()
  if (!drawing) return null

  const thumbnailUrl = await exportThumbnail()
  if (thumbnailUrl) emit('thumbnail', thumbnailUrl)

  dirty.value = false
  return { drawing, thumbnailUrl }
}

/**
 * Render the board to a PNG and park it in the bucket; the caller writes the URL to
 * OGImage, which is what every card in the grid already knows how to display.
 *
 * Returns null for an empty board (exportImage resolves null) and for a board whose
 * assets we could not inline — that canvas is tainted and the export would throw.
 */
async function exportThumbnail() {
  const editor = instance.value?.editor
  if (!editor || tainted.value) return null

  try {
    const blob = await editor.exportImage({ background: true, scale: 2, margin: 24 })
    if (!blob) return null
    return await uploadDrawingAsset(await blobToDataUrl(blob), `thumb-${Date.now()}`)
  } catch (err) {
    console.error('[drawing] thumbnail export failed:', err)
    return null
  }
}

// ─── external state ───────────────────────────────────────────────────

watch(() => colorMode?.value, () => instance.value?.editor.setTheme(themeId()))

watch(() => props.readonly, (ro) => instance.value?.editor.setReadonly(ro))

/**
 * Reload when the parent hands us a different drawing (the modal switching rows).
 * Guarded on identity: the parent also receives our own `update:modelValue` echoes,
 * and reloading on those would fight the user mid-stroke.
 */
watch(() => props.modelValue, async (next) => {
  const editor = instance.value?.editor
  if (!editor || !next || next === lastPublished) return

  const { snapshot, cache, tainted: couldNotInline } = await hydrateSnapshot(next)
  assetCache = cache
  tainted.value = couldNotInline

  loading = true
  editor.store.loadSnapshot(snapshot, 'remote')
  loading = false
})
watch(() => props.modelValue, (v) => { lastPublished = v }, { flush: 'sync' })

defineExpose({
  commit,
  isDirty: () => dirty.value,
  getSnapshot: () => instance.value?.editor.store.getSnapshot() ?? emptyDrawingSnapshot(),
})
</script>

<style>
/* Plain CSS on purpose: @tailwindcss/vite only processes Vue style blocks with
   lang="css", so @apply inside lang="scss" is dropped silently and the host
   collapsed to 0px. */
.quickdraw-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
}

.quickdraw-host {
  position: absolute;
  inset: 0;
}

.quickdraw-tainted-note {
  position: absolute;
  top: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  line-height: 1rem;
  background: rgb(245 158 11 / 0.15);
  color: #b45309;
  backdrop-filter: blur(8px);
}

.dark .quickdraw-tainted-note {
  color: #fcd34d;
}
</style>
