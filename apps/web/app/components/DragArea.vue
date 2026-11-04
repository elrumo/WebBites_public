<template>
    <UModal v-model:open="dragImageModal">
  <template #content>
        <div
            class="dragging-area-canvas"
            @dragover.prevent
            @dragleave="debounce(() => onDragLeave(), 50)"
        ></div>

        <div
            class="modal-body z-50"
            @drop.prevent="onDrop"
            @dragover.prevent="isDragOver = true"
            @dragleave="debounce(() => isDragOver = false, 10)"
        >
            <div
                class="dragging-area-content"
                :class="isDragOver ? 'bg-neutral-200/55 dark:bg-neutral-500 border-neutral-300 dark:border-neutral-500' : ''">
                <img
                    class="w-20 h-auto object-contain transition-all"
                    :class="isDragOver ? 'scale-125' : ''"
                    src="@/assets/images/WebBites-Icon.png"
                    alt=""
                />
                {{ $t('common.drop_image') }}
            </div>
        </div>
    
  </template>
</UModal>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useStore } from '~/stores/myStore'
import { splitByKind, unsupportedFileMessage } from '~/composables/useFileKinds'

const { t } = useI18n()
const store = useStore()

const {
        showAlert,
        uploadFilesToParse,
        handleParseError,
        importBookmarksFile,
        createDebounce
    } = store

const { dragImageModal, filesToUpload, draggedWebsite, activeBoard } = storeToRefs(store)

const debounce = ref(createDebounce());
const isDragOver = ref(false)

// Not awaited by the caller: the rows only exist once the upload has been
// processed, so the ids are polled for (see `bookmarkIdForCustomId`).
const fileIntoBoard = async (board, customIds = []) => {
    try {
        const ids = (await Promise.all(customIds.map(id => store.bookmarkIdForCustomId(id)))).filter(Boolean)
        if (!ids.length) throw new Error('uploaded bookmarks not found')
        await useBoards().addBookmarksToBoard(board.id, ids)
        showAlert({ message: t('bookmark_options.added_to_board', { board: board.name }) })
    } catch (error) {
        console.error('Error adding dropped files to board:', error)
        showAlert({ message: t('bookmark_options.add_error'), type: 'danger' })
    }
}

const onDrop = async (event) => {
  console.log("event: ", event)
    try {
        if (
            event.dataTransfer.files[0].type.includes('csv') ||
            event.dataTransfer.files[0].type.includes('json') ||
            event.dataTransfer.files[0].type.includes('txt') ||
            event.dataTransfer.files[0].type.includes('html')
        ) {
            importBookmarksFile(event.dataTransfer.files[0])
            dragImageModal.value = false;
            return
        }

        // Pictures, PDFs and recordings are all kept, and a drop can mix them:
        // the store splits the list and sends each part where it belongs.
        // Anything else is refused here rather than uploaded and rejected
        // downstream.
        const dropped = Array.from(event.dataTransfer.files)
        const { images, pdfs, audios, other } = splitByKind(dropped)

        if (images.length === 0 && pdfs.length === 0 && audios.length === 0) {
            showAlert({
                message: unsupportedFileMessage(other),
                type: 'danger'
            })
            return;
        }

        dragImageModal.value = false;
        showAlert({
            message: dropped.length > 1 ? t('alerts.file_upload.uploading_many') : t('alerts.file_upload.uploading_one'),
            type: 'info',
            permanent: true
        })

        // Dropping onto a board view means "put these in this board". Read it
        // now: the user may switch boards while the upload runs.
        const board = activeBoard.value;

        filesToUpload.value = event.dataTransfer.files;
        let upload = await uploadFilesToParse();

        if (!upload.error) {
            showAlert({ message: t('alerts.file_upload.success') })
            if (board) fileIntoBoard(board, upload.customIds)
            return;
        } else {
            // uploadFilesToParse has already said what went wrong and taken its
            // placeholder cards away; this only logs.
            handleParseError(upload.error, 'uploading files onDrop(), DragArea.vue');
            return;
        }
    } catch (error) {
        console.log("Error onDrop: ", error)
    }
}

const onDragLeave = (event) => {
    // if (draggedWebsite.value) return;
    if (isDragOver.value) return;
    dragImageModal.value = false;
    isDragOver.value = false
}
</script>

<style>
@reference "../assets/css/tailwind.css";
    .dragging-area-canvas{
        @apply
            w-screen
            h-screen
            fixed
            top-0
            left-0
        ;
    }

    .dragging-area-content{
        @apply
            flex
            flex-col
            items-center
            justify-center
            w-full
            h-full
            border-2
            px-24
            py-12
            border-dashed
            rounded-lg
            transition-all
            duration-200
            cursor-pointer
            font-medium
        ;

        *{
            @apply pointer-events-none;
        }
    }
</style>
