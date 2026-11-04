<template>
  <div class="drawing-view-wrapper" @pointerdown="isEditingDrawing = true">
    <LazyQuickDrawCanvas
      ref="canvas"
      class="w-full h-full"
      :modelValue="webToShow.drawing"
      @update:modelValue="onDrawingUpdated"
      @thumbnail="onThumbnail"
    />
  </div>
</template>

<script setup>
/**
 * Detail-view wrapper for a drawing — the drawing counterpart of <TextNoteView>.
 *
 * Autosave shape matches the text note: the board publishes a debounced snapshot, we
 * push it at the row. It writes through /api/updateDrawing rather than
 * `saveUpdatedSite` because a snapshot needs a size check before it reaches Mongo and
 * because the native app shares the same endpoint.
 *
 * `isEditingDrawing` is the same protection `hasFocusTipTap` gives a text note: an
 * incoming LiveQuery update carries the row as the server last saw it, and applying it
 * over an in-progress edit blanks the board under the user's pen. See the websites
 * subscription handler in myStore.
 */
import { ref, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()
const store = useStore()

const { createDebounce, updateDrawing, showAlert } = store
const { webToShow, isEditingDrawing } = storeToRefs(store)

const canvas = ref(null)
const debounce = createDebounce()
/** Latest thumbnail URL, folded into the next write rather than sent on its own. */
const pendingThumbnail = ref(null)

function onDrawingUpdated(drawing) {
  // Keep the local row in step so closing and reopening the modal without a round
  // trip shows what the user just drew.
  webToShow.value.drawing = drawing
  debounce(() => save(drawing), 600)
}

function onThumbnail(url) {
  pendingThumbnail.value = url
  // A thumbnail only arrives on commit, which has already published its snapshot —
  // write it straight through so the card in the grid updates.
  save(webToShow.value.drawing)
}

async function save(drawing) {
  if (!drawing || !webToShow.value?.objectId) return

  const result = await updateDrawing(webToShow.value.objectId, drawing, pendingThumbnail.value)
  pendingThumbnail.value = null

  if (result === 'Error') {
    showAlert({ message: t('cards.drawing.save_failed'), type: 'danger' })
  }
}

onBeforeUnmount(() => {
  isEditingDrawing.value = false
})
</script>

<style>
.drawing-view-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 60vh;
}
</style>
