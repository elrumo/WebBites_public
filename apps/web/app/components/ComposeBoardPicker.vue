<template>
  <!-- The board the new bookmark lands on, after the native composer's board
       menu: "No board", the user's boards, and a new one. A popover rather
       than a dropdown menu so "New board…" can take its name right here —
       opening the full board modal would close the composer under it. -->
  <UPopover
    v-model:open="open"
    :content="{ side: 'top', align: 'start', sideOffset: 8 }"
    :ui="{ content: 'z-[1000] w-64 max-w-[calc(100vw-2rem)] p-1.5 rounded-xl' }"
  >
    <button
      type="button"
      class="nb-pill"
      :class="{ 'nb-pill--on': !!modelValue, 'nb-pill--square': !modelValue }"
      :aria-label="$t('bookmarks.compose.board_label', { board: modelValue?.name || $t('bookmarks.compose.no_board') })"
    >
      <UIcon :name="modelValue ? 'i-heroicons-rectangle-stack-solid' : 'i-heroicons-rectangle-stack'" class="size-4 shrink-0" />
      <span v-if="modelValue" class="truncate max-w-28">{{ modelValue.name }}</span>
    </button>

    <template #content>
      <div class="flex flex-col" role="listbox" :aria-label="$t('bookmarks.compose.board')">
        <button
          type="button"
          role="option"
          class="nb-board-row"
          :aria-selected="!modelValue"
          @click="choose(null)"
        >
          <UIcon name="i-heroicons-inbox" class="size-4 shrink-0 opacity-60" />
          <span class="flex-1 truncate">{{ $t('bookmarks.compose.no_board') }}</span>
          <UIcon v-if="!modelValue" name="i-heroicons-check" class="size-4 shrink-0 text-primary" />
        </button>

        <div v-if="visibleBoards.length || boardsLoading" class="my-1 border-t border-default" />

        <div class="max-h-60 overflow-y-auto overscroll-contain">
          <div v-if="boardsLoading && !visibleBoards.length" class="flex justify-center py-3">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin opacity-60" />
          </div>
          <button
            v-for="board in visibleBoards"
            :key="board.id"
            type="button"
            role="option"
            class="nb-board-row"
            :aria-selected="modelValue?.id === board.id"
            @click="choose(board)"
          >
            <span v-if="board.icon" class="w-4 text-center text-sm leading-none shrink-0">{{ board.icon }}</span>
            <span v-else class="size-2.5 mx-[3px] rounded-full shrink-0" :style="{ background: board.color || 'var(--ui-text-muted)' }" />
            <span class="flex-1 truncate">{{ board.name }}</span>
            <UIcon v-if="modelValue?.id === board.id" name="i-heroicons-check" class="size-4 shrink-0 text-primary" />
          </button>
        </div>

        <div class="my-1 border-t border-default" />

        <form v-if="creating" class="flex items-center gap-1.5 p-1" @submit.prevent="create">
          <UInput
            ref="nameInput"
            v-model="newName"
            size="sm"
            class="flex-1"
            autofocus
            :placeholder="$t('bookmarks.compose.board_name')"
            @keydown.esc.stop="creating = false"
          />
          <UButton
            type="submit"
            size="sm"
            :loading="savingBoard"
            :disabled="!newName.trim()"
          >
            {{ $t('bookmarks.compose.create_board') }}
          </UButton>
        </form>
        <button v-else type="button" class="nb-board-row" @click="startCreating">
          <UIcon name="i-heroicons-plus" class="size-4 shrink-0 opacity-60" />
          <span class="flex-1 truncate">{{ $t('bookmarks.compose.new_board') }}</span>
        </button>
      </div>
    </template>
  </UPopover>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

/** The chosen board, or null for none. */
const modelValue = defineModel({ type: Object, default: null })

const store = useStore()
const { boards, plainBoards, boardsLoaded, boardsLoading } = storeToRefs(store)
const { t } = useI18n()

const open = ref(false)
const creating = ref(false)
const newName = ref('')
const savingBoard = ref(false)
const nameInput = ref(null)

/** Archived boards have left the sidebar; they are not somewhere to save to. */
const visibleBoards = computed(() => (plainBoards.value || []).filter(board => board && !board.archived))

watch(open, (value) => {
  if (!value) {
    creating.value = false
    newName.value = ''
    return
  }
  if (!boardsLoaded.value && !boardsLoading.value) store.fetchBoards()
})

const choose = (board) => {
  modelValue.value = board
  open.value = false
}

const startCreating = async () => {
  creating.value = true
  await nextTick()
  nameInput.value?.inputRef?.focus?.()
}

const create = async () => {
  const name = newName.value.trim()
  if (!name || savingBoard.value) return
  savingBoard.value = true
  try {
    const { createBoard } = useBoards()
    const response = await createBoard({ name, mode: 'manual' })
    if (!response?.board) throw new Error('createBoard returned no board')
    boards.value.push(response.board)
    choose(response.board)
  } catch (error) {
    console.error('[ComposeBoardPicker] creating a board failed: ', error)
    store.showAlert({ message: t('bookmarks.compose.board_create_failed'), type: 'danger' })
  } finally {
    savingBoard.value = false
  }
}
</script>

<style>
@reference "../assets/css/tailwind.css";

.nb-board-row {
  @apply flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg text-sm text-start
         text-default hover:bg-elevated/70 focus-visible:bg-elevated/70 outline-none
         transition-colors duration-150;
}
</style>
