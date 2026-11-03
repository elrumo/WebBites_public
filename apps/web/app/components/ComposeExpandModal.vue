<template>
    <!-- ===================================================================
         Compose → full-screen editor
         The composer's card grows into this sheet. The parent has already
         saved the bookmark before we mount, so everything written here is
         an edit on a row that exists — the same autosave shape as
         <TextNoteView> and <DrawingView> inside the detail modal.
    ==================================================================== -->
    <UModal
        v-model:open="open"
        :fullscreen="true"
        :transition="false"
        :dismissible="true"
        :ui="{
            /* Above the composer's z-[999]: the popover is still fading out
               underneath as the sheet grows, and it must not cover the morph. */
            wrapper: 'relative z-[1000]',
            content: 'overflow-hidden',
            overlay: 'data-[state=open]:animate-[fade-in_200ms_ease-out] data-[state=closed]:animate-[fade-out_200ms_ease-in]',
        }"
    >
        <template #content>
            <div ref="shellEl" class="nb-expand" :class="'nb-expand--' + (payload?.type || '')">
                <header class="nb-expand-bar">
                    <p class="nb-expand-title">{{ titleLabel }}</p>
                    <UButton
                        variant="ghost"
                        color="neutral"
                        square
                        size="md"
                        icon="i-heroicons-x-mark"
                        :aria-label="t('common.close')"
                        @click="requestClose"
                    />
                </header>

                <div class="nb-expand-body" :class="'nb-expand-body--' + (payload?.type || '')">
                    <!-- Note. The detail modal's editor verbatim: autosave on a
                         500ms quiet spell, no Save button to reach for. -->
                    <LazyTiptap
                        v-if="payload?.type === 'textNote'"
                        class="w-full h-full"
                        :id="'composeExpandEditor'"
                        :outlineWhenFocused="false"
                        v-model="noteHtml"
                        @update:modelValue="onNoteUpdated"
                    />

                    <!-- Drawing. Same board as the composer had, now with room
                         to use it; commits on its own quiet spell and on close. -->
                    <LazyQuickDrawCanvas
                        v-else-if="payload?.type === 'drawing'"
                        ref="canvas"
                        class="w-full h-full"
                        :modelValue="drawingSnapshot"
                        @update:modelValue="onDrawingUpdated"
                        @thumbnail="onThumbnail"
                    />
                </div>
            </div>
        </template>
    </UModal>
</template>

<script setup>
/**
 * Full-screen hand-off for a note or a drawing that was just saved from the
 * composer.
 *
 * The morph is a FLIP: the card's rect is captured before the popover closes,
 * and this sheet is inverted into that rect and animated out to full size.
 * Measuring happens with the shell hidden and in one synchronous block, so the
 * inverted frame is the first one painted — a full-size flash before the
 * animation starts would read as a jump, not a transition.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()

const props = defineProps({
    /** `{ type, bookmarkId, noteHtml, drawing, originRect }`, or null when closed. */
    payload: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const store = useStore()
const { createDebounce, saveUpdatedSite, updateDrawing, showAlert } = store

const shellEl = ref(null)
const canvas = ref(null)

const noteHtml = ref('')
const drawingSnapshot = ref(null)
/** Latest thumbnail URL, folded into the next write rather than sent on its own. */
const pendingThumbnail = ref(null)
/** The note as last written, so closing does not re-save a quiet editor. */
let savedNoteHtml = ''
/** Which bookmark the editors are loaded for, so a late shell does not reload them. */
let loadedId = null
/** Set while `commit()` runs from our own flush, so its thumbnail echo does not save twice. */
let flushing = false
let leaving = false

const noteDebounce = createDebounce()
const drawingDebounce = createDebounce()

/**
 * Writable so Reka's Escape / overlay dismiss comes through us: the sheet
 * stays mounted for its leave beat, then the parent clears `payload`.
 */
const open = computed({
    get: () => !!props.payload,
    set: (v) => { if (!v) requestClose() },
})

const titleLabel = computed(() =>
    props.payload?.type === 'drawing'
        ? t('bookmarks.types.drawing')
        : t('bookmarks.types.textNote')
)

/**
 * Reset for a new sheet and start the morph.
 *
 * Watched on `shellEl` as well as `payload`: the modal teleports its content
 * into the overlay, so the div is not in the DOM in the same tick the payload
 * arrives — and `playEnter` has nothing to measure until it is.
 *
 * `flush: 'post'` because this is all measurement and DOM work (`getBoundingClientRect`,
 * `querySelector`); the shell ref is filled during patch, and a pre-flush
 * callback would still be looking at the previous frame's tree.
 */
watch([() => props.payload, shellEl], ([payload, shell]) => {
    if (!payload) return

    // Only reset the editors when a *new* bookmark arrives; the shell coming
    // in late must not throw away what is already loaded.
    if (loadedId !== payload.bookmarkId) {
        loadedId = payload.bookmarkId
        noteHtml.value = payload.noteHtml || ''
        savedNoteHtml = noteHtml.value
        drawingSnapshot.value = payload.drawing || null
        pendingThumbnail.value = null
    }
    leaving = false

    if (shell) playEnter()
}, { immediate: true, flush: 'post' })

// ── The morph ────────────────────────────────────────────────────────────────

const reducedMotion = () =>
    typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The in-flight morph, so a quick close can cancel it rather than fight it. */
let enterAnimation = null

/**
 * Invert the sheet into the card's rect and spring it out to full size.
 *
 * `transform-origin: top left` (set in CSS) makes the arithmetic direct: the
 * inverse of "scale by `to/from` and slide by `to - from`" is "slide by
 * `from - to` and scale by `from/to`", which is what the first keyframe holds.
 *
 * The shell ships `visibility: hidden` from CSS so the full-size sheet is
 * never painted: the invert is written and revealed in the same frame, and
 * anything that cannot run the morph reveals it as-is.
 */
function playEnter() {
    const shell = shellEl.value
    if (!shell) return

    enterAnimation?.cancel()
    enterAnimation = null

    const from = props.payload?.originRect
    if (!from || reducedMotion()) {
        shell.style.visibility = ''
        return
    }

    // Measure at full size: the rect has to be the sheet's own, and the
    // inverted frame must be the first one the user sees.
    shell.style.visibility = 'hidden'
    const to = shell.getBoundingClientRect()
    if (to.width < 1 || to.height < 1) {
        shell.style.visibility = ''
        return
    }

    const dx = from.left - to.left
    const dy = from.top - to.top
    const sx = from.width / to.width
    const sy = from.height / to.height
    const first = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`

    shell.style.transform = first
    shell.style.borderRadius = '22px'
    shell.style.visibility = ''

    const anim = shell.animate(
        [
            { transform: first, borderRadius: '22px' },
            { transform: 'none', borderRadius: '0px' },
        ],
        { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
    )
    enterAnimation = anim

    // Clear the invert once it lands. Without this the inline `transform`
    // outlives the animation (which is not filled forwards) and the sheet
    // snaps back to the card's size the frame after it arrives — and a later
    // `playLeave` would measure that stale rect as its start.
    anim.onfinish = () => {
        shell.style.transform = ''
        shell.style.borderRadius = ''
        if (enterAnimation === anim) enterAnimation = null
    }

    // Chrome fades up behind the sheet so the header does not ride the scale.
    shell.querySelector('.nb-expand-bar')?.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 220, delay: 160, easing: 'ease-out', fill: 'backwards' }
    )
}

/** Collapse back toward the card's ghost, then hand the close to the parent. */
function playLeave() {
    return new Promise((resolve) => {
        const shell = shellEl.value
        const to = props.payload?.originRect
        if (!shell || !to || reducedMotion()) return resolve()

        // A close mid-morph would otherwise compose two animations on the same
        // transform and measure from the in-between frame.
        enterAnimation?.cancel()
        enterAnimation = null
        shell.style.transform = ''
        shell.style.borderRadius = ''

        const from = shell.getBoundingClientRect()
        const dx = to.left - from.left
        const dy = to.top - from.top
        const sx = to.width / from.width
        const sy = to.height / from.height

        const anim = shell.animate(
            [
                { transform: 'none', opacity: 1 },
                { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4 },
            ],
            { duration: 240, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
        )
        anim.onfinish = resolve
    })
}

async function requestClose() {
    if (leaving) return
    leaving = true

    await flushSave()
    await playLeave()
    emit('close')
}

// ── Autosave ─────────────────────────────────────────────────────────────────

function onNoteUpdated(html) {
    noteHtml.value = html
    noteDebounce(() => saveNoteNow(html), 500)
}

async function saveNoteNow(html) {
    const bookmarkId = props.payload?.bookmarkId
    if (!bookmarkId || html === savedNoteHtml) return

    savedNoteHtml = html
    await saveUpdatedSite(bookmarkId, 'textNote', html)
}

function onDrawingUpdated(drawing) {
    drawingSnapshot.value = drawing
    drawingDebounce(() => saveDrawingNow(drawing, pendingThumbnail.value), 600)
}

function onThumbnail(url) {
    pendingThumbnail.value = url
    // A thumbnail only arrives on commit, which has already published its
    // snapshot — write it through so the card in the grid updates. Suppressed
    // during our own close-flush, which saves the pair itself.
    if (flushing) return
    saveDrawingNow(drawingSnapshot.value, url)
}

async function saveDrawingNow(drawing, thumbnailUrl) {
    const bookmarkId = props.payload?.bookmarkId
    if (!bookmarkId || !drawing) return

    const result = await updateDrawing(bookmarkId, drawing, thumbnailUrl)
    if (thumbnailUrl) pendingThumbnail.value = null

    if (result === 'Error') {
        showAlert({ message: t('compose_expand.save_drawing_error'), type: 'danger' })
    }
}

/**
 * Land anything still in a debounce window.
 *
 * Closing is the one moment a lost keystroke is unrecoverable — the editor is
 * gone by the time the timer would have fired.
 */
async function flushSave() {
    const payload = props.payload
    if (!payload) return

    if (payload.type === 'textNote') {
        await saveNoteNow(noteHtml.value)
        return
    }

    if (payload.type === 'drawing') {
        flushing = true
        try {
            const committed = await canvas.value?.commit()
            if (committed?.drawing) {
                await saveDrawingNow(committed.drawing, committed.thumbnailUrl || pendingThumbnail.value)
            } else if (pendingThumbnail.value) {
                await saveDrawingNow(drawingSnapshot.value, pendingThumbnail.value)
            }
        } finally {
            flushing = false
        }
    }
}

onBeforeUnmount(() => {
    flushSave()
})
</script>

<style>
/* Non-scoped: UModal teleports the sheet to the overlay, outside this
   component's element scope. */

.nb-expand {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  /* `top left` keeps the invert's translate/scale in viewport terms — the
     origin rect was measured in the same space. */
  transform-origin: top left;
  will-change: transform;
  overflow: hidden;
  /* Unpainted until `playEnter` has written the invert. The full-size sheet
     must never be the first frame — that would read as a jump, not a morph. */
  visibility: hidden;
  /* The composer's material, so the first inverted frame is recognisably the
     card and the morph reads as one surface stretching. */
  background-color: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(28px);
  -webkit-backdrop-filter: saturate(180%) blur(28px);
}

.dark .nb-expand {
  background-color: rgba(28, 28, 30, 0.94);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .nb-expand { background-color: #ffffff; }
  .dark .nb-expand { background-color: #1c1c1e; }
}

.nb-expand-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px 10px 22px;
  flex: 0 0 auto;
}

.nb-expand-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ui-text-muted, #6b7280);
}

.nb-expand-body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0 22px 22px;
}

/* The board wants edge-to-edge room; the note wants a measure. */
.nb-expand-body--drawing {
  padding: 0 10px 10px;
}

.nb-expand-body--drawing > * {
  border-radius: 0.75rem;
  overflow: hidden;
  border: 1px solid rgb(0 0 0 / 0.08);
}

.dark .nb-expand-body--drawing > * {
  border-color: rgb(255 255 255 / 0.10);
}

@media (prefers-reduced-motion: reduce) {
  .nb-expand { will-change: auto; }
}
</style>
