<template>
    <div class="new-bookmark-content-inner">
        <!-- Drawing board. Its own editor, so it replaces the text input rather than
             sitting under it. -->
        <div v-if="typeOfNewBookmark == 'drawing'" class="new-bookmark-drawing">
            <LazyQuickDrawCanvas
                :ref="(el) => onDrawingReady(el)"
                :modelValue="drawingSnapshot"
                @update:modelValue="onDrawingUpdated($event)"
            />
        </div>

        <!-- Recorder. Its own panel like the drawing board, because a voice
             note is made here rather than picked: there is nothing to type,
             and the file picker is the fallback inside it rather than the way
             in. -->
        <div v-else-if="typeOfNewBookmark == 'audio'" class="new-bookmark-audio">
            <AudioRecorder />
        </div>

        <!-- Text / URL editor (everything except pure image and drawing).
             `tag` is a TransitionGroup prop and did nothing here; the class is
             already on the child it would have fallen through to. -->
        <Transition name="blur-in" mode="out-in">
            <div class="new-bookmark-input" v-if="typeOfNewBookmark != 'image' && typeOfNewBookmark != 'pdf' && typeOfNewBookmark != 'drawing' && typeOfNewBookmark != 'audio'">
                <LazyTiptap
                    v-if="startLoadingTipTap"
                    class="w-full"
                    :placeholder="editorPlaceholder"
                    :showFloatingMenu="showFloatingMenu"
                    @update:modelValue="onNotesUpdated($event)"
                    :visible="desktopModal"
                    :id="'newBookmarkEditor'"
                    v-model="editorModel"
                    @pasteNewUrl="onPasteNewUrl()"
                    :newBookmark="true"
                />

                <div
                    v-if="!isTextboxEmpty && !showPlaceholder"
                    class="clear-tiptap-url"
                >
                    <UButton
                        variant="ghost"
                        square
                        size="xs"
                        class="hover:scale-110 hover:shadow-md"
                        @click="onClearNotes()"
                        icon="i-tabler-x"
                    />
                </div>
            </div>
        </Transition>

        <!-- Type-specific preview.

             No `key` on the Transition itself: keying it on the type tore the
             whole Transition down and built a new one every time the type
             changed, and if the old child was still animating out Vue was left
             patching a subtree whose parent had gone — "Cannot read properties
             of null (reading 'insertBefore')". The branches below already
             identify themselves. -->
        <Transition
            name="blur-in"
            class="pt-6"
        >
            <!-- Website preview. Only once there is a link to preview: the
                 composer now opens on "website" rather than being switched to
                 it deliberately, and a skeleton card sitting under an empty
                 field reads as something that failed to load. -->
            <PreviewBookmarkCard
                v-if="typeOfNewBookmark == 'website' && !isTextboxEmpty && !showPlaceholder && validateUrl(cleanedNoteText)"
                @removeBookmark="onClearNotes()"
                :url="newUrlValue"
                :sitePreview="sitePreview"
            />

            <!-- Media preview (selected movie / game) -->
            <div v-else-if="(typeOfNewBookmark == 'movie' || typeOfNewBookmark == 'game') && mediaBookmark != null && Object.keys(mediaBookmark).length > 0">
                <MediaPreviewCard
                    :mediaBookmark="mediaBookmark"
                    :typeOfMedia="typeOfNewBookmark"
                    @removeBookmark="onClearNotes()"
                    :showDelete="true"
                />
            </div>

            <!-- File picker and preview, for both images and PDFs. Shown for
                 the whole of the type, not only once a file has been chosen:
                 picking "Image" and then cancelling the file dialog used to
                 leave an empty panel with nothing to click.

                 A picture previews as itself. A PDF has no cover until the
                 server has rendered its first page, so the panel names the
                 files instead — which is still the confirmation that what was
                 picked is what is about to be saved. -->
            <div class="image-uploader-wrapper" v-else-if="typeOfNewBookmark == 'image' || typeOfNewBookmark == 'pdf'">
                <img v-if="fileUrl.length > 1" class="upload-image" :src="fileUrl" alt="">

                <div v-else-if="pickedFileNames.length > 0" class="file-picker-list">
                    <p v-for="name in pickedFileNames" :key="name" class="file-picker-name">
                        <UIcon name="i-heroicons-document-text" />
                        <span>{{ name }}</span>
                    </p>
                </div>

                <!-- Over the picture once there is one; a plain button while
                     there is not. The floating variant is `opacity: 0` until
                     its wrapper is hovered, and an empty wrapper has no height
                     to hover — which is how choosing "Image" and cancelling the
                     file dialog left a card with nothing to press. -->
                <div :class="fileUrl.length > 1 ? 'image-button-wrapper' : 'image-picker-empty'">
                    <UButton
                        @click="onClickEl('inputNewFileMobile')"
                        variant="soft"
                        color="primary"
                    >
                        {{ pickerLabel }}
                        <input
                            style="display: none;"
                            id="inputNewFileMobile"
                            @change="onChange($event)"
                            type="file"
                            multiple
                            :accept="pickerAccept"
                            autofocus
                        />
                    </UButton>
                </div>
            </div>
        </Transition>

        <!-- Movie search results.

             In the wizard the list is a dropdown that floats over the page. In
             the composer it is not: the popover is only a few hundred pixels
             tall, and an absolutely positioned list hung over the field it was
             filtering and over the type selector under it. There it is part of
             the card, and the card grows around it. -->
        <TransitionGroup
            tag="div"
            name="slide-up"
            v-if="(cleanedNoteText.length > 0 && typeOfNewBookmark == 'movie' || (loadingMedia && typeOfNewBookmark == 'movie')) && showMediaDropdown"
            :class="isInline ? 'movie-options-wrapper' : 'nb-results'"
        >
            <MediaPreviewCard
                v-if="loadingMedia"
                v-for="n in (isInline ? 10 : 4)"
                :skeleton="true"
                :typeOfMedia="typeOfNewBookmark"
                :key="n + '-loading'"
            />

            <MediaPreviewCard
                v-else-if="searchResultsMovies.length > 0"
                v-for="movie in searchResultsMovies"
                @click="onSelectMedia(movie)"
                :mediaBookmark="movie"
                :typeOfMedia="typeOfNewBookmark"
                :key="movie.id"
            />

            <div v-else-if="searchResultsMovies.length == 0">
                <p class="w-full text-center opacity-50">{{ $t('bookmark_editor.no_results_for', { query: cleanedNoteText }) }}</p>
            </div>
        </TransitionGroup>

        <!-- Game search results. In the card rather than over it — see above. -->
        <TransitionGroup
            tag="div"
            name="slide-up"
            v-if="(cleanedNoteText.length > 0 && typeOfNewBookmark == 'game' || (loadingMedia && typeOfNewBookmark == 'game')) && showMediaDropdown"
            :class="isInline ? 'game-options-wrapper' : 'nb-results'"
        >
            <MediaPreviewCard
                v-if="loadingMedia"
                v-for="n in (isInline ? 10 : 4)"
                :skeleton="true"
                :typeOfMedia="typeOfNewBookmark"
                :key="n + '-loading'"
            />
            <MediaPreviewCard
                v-else-if="searchResultsGames.length > 0"
                v-for="game in searchResultsGames"
                @click="onSelectMedia(game)"
                :mediaBookmark="game"
                :typeOfMedia="typeOfNewBookmark"
                :key="game.id"
            />

            <div v-if="searchResultsGames.length == 0">
                <p class="w-full text-center opacity-50">{{ $t('bookmark_editor.no_results_for', { query: cleanedNoteText }) }}</p>
            </div>
        </TransitionGroup>
    </div>
</template>

<script setup>
/**
 * Presentational editor used by <newBookmark> in both the popover and the
 * inline (wizard) contexts. All state lives in the parent; this component just
 * renders the TipTap editor, the type-specific preview, and the media-search
 * dropdowns, emitting events back up.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { UPLOAD_ACCEPT } from '~/composables/useFileKinds'

const { t } = useI18n()

const props = defineProps({
    typeOfNewBookmark: { type: String, default: 'empty' },
    startLoadingTipTap: { type: Boolean, default: false },
    showFloatingMenu: { type: Boolean, default: false },
    desktopModal: { type: Boolean, default: false },
    newWebsiteData: { type: Object, required: true }, // ref passed through for v-model
    sitePreview: { type: Object, default: null },
    newUrlValue: { type: String, default: '' },
    mediaBookmark: { type: Object, default: null },
    fileUrl: { type: String, default: '' },
    filesToUpload: { type: [Array, Object], default: () => [] },
    pickedFileNames: { type: Array, default: () => [] },
    isTextboxEmpty: { type: Boolean, default: true },
    showPlaceholder: { type: Boolean, default: false },
    cleanedNoteText: { type: String, default: '' },
    loadingMedia: { type: Boolean, default: false },
    showMediaDropdown: { type: Boolean, default: false },
    searchResultsMovies: { type: Array, default: () => [] },
    searchResultsGames: { type: Array, default: () => [] },
    isInline: { type: Boolean, default: false },
    drawingSnapshot: { type: Object, default: null },
    onDrawingUpdated: { type: Function, default: () => {} },
    onDrawingReady: { type: Function, default: () => {} },
    validateUrl: { type: Function, default: () => false },
    onNotesUpdated: { type: Function, default: () => {} },
    onPasteNewUrl: { type: Function, default: () => {} },
    onClearNotes: { type: Function, default: () => {} },
    onSelectMedia: { type: Function, default: () => {} },
    onChange: { type: Function, default: () => {} },
    onClickEl: { type: Function, default: () => {} },
})

/**
 * What the empty field asks for.
 *
 * The composer no longer opens on a question, so the prompt is the only thing
 * telling you what this field takes — and what it takes depends on the type
 * the selector is sitting on. Blank falls back to the editor's own note
 * prompt, which is what every other TipTap in the app gets.
 */
/**
 * The picker takes both kinds whichever chip opened it — someone who meant to
 * save a paper and pressed "Image" should not have to go back and start again,
 * and `onChange` moves the type to match what they actually picked.
 */
const pickerAccept = UPLOAD_ACCEPT

const pickerLabel = computed(() => {
    const count = props.filesToUpload.length
    if (count === 0) return t('bookmarks.add_files')
    return t('bookmarks.change_files', { count })
})

const editorPlaceholder = computed(() => {
    switch (props.typeOfNewBookmark) {
        case 'website':
        case 'empty':
            return t('bookmarks.new_placeholder.link')
        case 'textNote':
            return t('bookmarks.new_placeholder.note')
        case 'movie':
            return t('bookmarks.new_placeholder.movie')
        case 'game':
            return t('bookmarks.new_placeholder.game')
        default:
            return ''
    }
})

// `newWebsiteData` is a ref object handed down from the parent so v-model
// mutations write straight back to the parent's state.
const editorModel = computed({
    get: () => props.newWebsiteData.value,
    set: (v) => { props.newWebsiteData.value = v },
})
</script>

<style>
.image-picker-empty {
    display: flex;
    justify-content: center;
    padding: 0.25rem 0;
}

.file-picker-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.25rem;
}

.file-picker-name {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
}

/* The recorder brings its own layout; this only gives it the card's width. */
.new-bookmark-audio {
    width: 100%;
    padding: 0 0.25rem;
}

/* The board needs real room to be usable; the popover widens to match (see the
   drawing branch of the width computation in newBookmark.vue). */
.new-bookmark-drawing {
    width: 100%;
    height: 380px;
    border-radius: 0.75rem;
    overflow: hidden;
    border: 1px solid rgb(0 0 0 / 0.08);
}

.dark .new-bookmark-drawing {
    border-color: rgb(255 255 255 / 0.10);
}
</style>
