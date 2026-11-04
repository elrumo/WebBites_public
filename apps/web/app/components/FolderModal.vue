<template>
  <UModal
    v-model:open="showFolderModal"
    :title="folderToEdit ? $t('boards.folder.rename_title') : $t('boards.folder.new_title')"
    :ui="{ content: 'max-w-sm' }"
  >
    <template #body>
      <UInput
        v-model="name"
        class="w-full"
        size="xl"
        :placeholder="$t('boards.folder.name_placeholder')"
        :maxlength="100"
        autofocus
        @keydown.enter="save"
      />
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="showFolderModal = false" />
        <UButton
          :label="folderToEdit ? $t('common.save') : $t('boards.folder.create')"
          :loading="saving"
          :disabled="!name.trim()"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup>
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()
const { t } = useI18n()
const { showFolderModal, folderToEdit, folderParentId } = storeToRefs(store)

const name = ref('')
const saving = ref(false)

watch(showFolderModal, (open) => {
  if (open) name.value = folderToEdit.value?.name ?? ''
}, { immediate: true })

const save = async () => {
  const trimmed = name.value.trim()
  if (!trimmed || saving.value) return
  saving.value = true
  try {
    const { createFolder, updateBoard } = useBoards()
    if (folderToEdit.value) {
      const { board } = await updateBoard(folderToEdit.value.id, { name: trimmed })
      store.replaceBoard(board)
    } else {
      const { board } = await createFolder({ name: trimmed, parentId: folderParentId.value })
      store.boards.push(board)
      store.expandBranch(board.parentId)
    }
    showFolderModal.value = false
  } catch (error) {
    console.error('Error saving folder:', error)
    store.showAlert({ message: t('boards.folder.save_error'), type: 'danger' })
  } finally {
    saving.value = false
  }
}
</script>
