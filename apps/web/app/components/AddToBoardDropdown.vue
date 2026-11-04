<template>
  <UPopover :ui="{ content: 'min-w-[220px] rounded-lg' }">
    <slot />

    <template #content>
      <div class="p-3 max-h-[300px] overflow-auto">
        <p class="text-xs font-semibold opacity-50 mb-2 uppercase tracking-wider">{{ $t('boards.add_to.title') }}</p>

        <div v-if="loadingMemberships" class="flex justify-center py-4">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin opacity-50" />
        </div>

        <div v-else-if="addableBoards.length === 0" class="text-sm opacity-50 py-2 text-center">
          {{ $t('boards.empty') }}
        </div>

        <div v-else class="flex flex-col gap-0.5">
          <button
            v-for="board in addableBoards"
            :key="board.id"
            class="flex items-center gap-2 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 w-full text-left text-sm transition-colors"
            :disabled="toggling === board.id"
            @click="toggleBoard(board)"
          >
            <UIcon
              :name="isMember(board.id) ? 'i-tabler-check' : 'i-tabler-plus'"
              class="w-4 h-4 flex-shrink-0"
              :class="isMember(board.id) ? 'text-green-500' : 'opacity-40'"
            />
            <span v-if="board.icon" class="flex-shrink-0 text-sm leading-none">{{ board.icon }}</span>
            <span
              v-else-if="board.color"
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: board.color }"
            />
            <span class="truncate">{{ board.name }}</span>
            <UIcon
              v-if="toggling === board.id"
              name="i-heroicons-arrow-path"
              class="w-3 h-3 animate-spin ml-auto opacity-50"
            />
          </button>
        </div>
      </div>
    </template>
  </UPopover>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const props = defineProps({
  // Single bookmark mode
  website: {
    type: Object,
    default: null
  },
  // Bulk mode: array of website objectIds
  websiteIds: {
    type: Array,
    default: null
  }
})

const store = useStore()
const { t } = useI18n()
const { boards, plainBoards } = storeToRefs(store)
// A board shared with you for viewing can't be added to.
const addableBoards = computed(() => plainBoards.value.filter(b => b.role !== 'viewer'))

const memberBoardIds = ref(new Set())
const loadingMemberships = ref(false)
const toggling = ref(null)

// Fetch which boards this bookmark belongs to (single mode only)
const fetchMemberships = async () => {
  if (!props.website?.objectId || props.websiteIds) return

  loadingMemberships.value = true
  try {
    const { getBoardsForBookmark } = useBoards()
    const response = await getBoardsForBookmark(props.website.objectId)
    memberBoardIds.value = new Set((response.boards || []).map(b => b.id))
  } catch (error) {
    console.error('Error fetching board memberships:', error)
  } finally {
    loadingMemberships.value = false
  }
}

// Fetch memberships when component mounts or website changes
watch(() => props.website?.objectId, () => {
  if (props.website?.objectId) fetchMemberships()
}, { immediate: true })

const isMember = (boardId) => memberBoardIds.value.has(boardId)

const toggleBoard = async (board) => {
  toggling.value = board.id

  try {
    const { addBookmarksToBoard, removeBookmarkFromBoard } = useBoards()

    if (props.websiteIds) {
      // Bulk mode: always add
      await addBookmarksToBoard(board.id, props.websiteIds)
      store.showAlert({ message: t('boards.added_bookmarks', { count: props.websiteIds.length, board: board.name }, props.websiteIds.length) })
      // Update board count
      const boardInList = boards.value.find(b => b.id === board.id)
      if (boardInList) {
        await store.fetchBoards()
      }
    } else if (props.website) {
      const websiteId = props.website.objectId
      if (isMember(board.id)) {
        // Remove from board
        await removeBookmarkFromBoard(board.id, websiteId)
        memberBoardIds.value.delete(board.id)
        // Update board count
        const boardInList = boards.value.find(b => b.id === board.id)
        if (boardInList && boardInList.bookmarkCount > 0) {
          boardInList.bookmarkCount -= 1
        }
        store.showAlert({ message: t('boards.add_to.removed_from', { board: board.name }) })
      } else {
        // Add to board
        await addBookmarksToBoard(board.id, [websiteId])
        memberBoardIds.value.add(board.id)
        // Update board count
        const boardInList = boards.value.find(b => b.id === board.id)
        if (boardInList) {
          boardInList.bookmarkCount += 1
        }
        store.showAlert({ message: t('boards.added_to', { board: board.name }) })
      }
    }
  } catch (error) {
    console.error('Error toggling board membership:', error)
    store.showAlert({ message: t('boards.add_to.update_error'), type: 'danger' })
  } finally {
    toggling.value = null
  }
}
</script>
