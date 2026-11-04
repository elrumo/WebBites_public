<template>
  <div class="px-1 flex items-center justify-between">
    <button
      type="button"
      class="flex items-center gap-1 min-w-0 opacity-70 hover:opacity-100 transition-opacity"
      @click="expanded = !expanded"
    >
      <UIcon
        name="i-tabler-chevron-down"
        class="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200"
        :class="{ '-rotate-90': !expanded }"
      />
      <h4 class="label">
        {{ $t('boards.sidebar.title') }}
      </h4>
    </button>
    <div class="flex items-center">
      <UButton
        size="xs"
        square
        variant="ghost"
        icon="i-tabler-folder-plus"
        :aria-label="$t('boards.sidebar.new_folder')"
        class="opacity-60 hover:opacity-100 p-1"
        @click="store.openFolderModal()"
      />
      <UButton
        size="xs"
        square
        variant="ghost"
        icon="i-tabler-plus"
        :aria-label="$t('boards.sidebar.new_board')"
        class="opacity-60 hover:opacity-100 p-1"
        @click="openCreateBoard"
      />
    </div>
  </div>

  <UCollapsible v-model:open="expanded" :unmount-on-hide="false">
    <template #content>
      <div class="bookmark-sidebar-list">
        <div v-if="boardsLoading && !boardsLoaded" class="flex justify-center py-3">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin opacity-50" />
        </div>

        <div v-else-if="boards.length === 0" class="text-xs opacity-50 py-2 px-2">
          {{ $t('boards.empty') }}
        </div>

        <UTabs
          :items="boardTabItems"
          v-model="selectedBoardValue"
          value-key="value"
          orientation="vertical"
          size="sm"
          :ui="{
            root: [
              'flex items-center gap-4'
            ],
            list: 'relative w-full h-full bg-transparent dark:bg-transparent p-0',
            indicator: [
              'bg-neutral-600 dark:bg-neutral-950 ring-1 ring-neutral-200/20 dark:ring-neutral-700/50 shadow-md shadow-neutral-600/20 dark:shadow-black/30 rounded-lg transition-all duration-200 ease-out',
              selectorVisible ? 'opacity-100' : 'opacity-0'
            ],
            trigger: 'w-full relative mb-0.5 px-2 w-full h-7 text-gray-500 transition-colors rounded-lg data-[state=inactive]:hover:bg-neutral-200 data-[state=inactive]:dark:hover:bg-neutral-700/60 data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:hover:text-white dark:data-[state=active]:text-white dark:data-[state=active]:hover:text-white',
            label: 'w-full truncate',
          }"
          :content="false"
        >
          <template #default="{ item }" class="w-full">
            <!-- Only the label span is wrapped: the triggers themselves must stay
                 direct siblings for the sliding indicator. `press-open-delay`
                 is the long-press that stands in for right-click on touch. -->
            <UContextMenu :items="boardMenuItems(item)" :press-open-delay="450" class="w-full">
            <span
              class="flex items-center justify-between gap-0.5 w-full text-sm p-0.5 group/board rounded-md transition-shadow"
              :class="dropClass(item.value)"
              :draggable="isOwner(item)"
              @dragstart="onRowDragStart($event, item)"
              @dragend="onRowDragEnd"
              @dragover="onBoardDragOver($event, item)"
              @dragleave="onBoardDragLeave($event, item.value)"
              @drop="onBoardDrop($event, item)"
            >
              <span
                class="flex items-center gap-2 min-w-0 truncate w-full"
                :style="{ paddingLeft: `${(item.depth ?? 0) * 12}px` }"
              >
                <!-- Only a branch gets a triangle; a leaf keeps the space so
                     the emoji column stays straight down the sidebar. -->
                <UIcon
                  v-if="item.hasChildren"
                  name="i-tabler-chevron-down"
                  class="w-3 h-3 flex-shrink-0 opacity-60 transition-transform duration-200"
                  :class="{ '-rotate-90': item.isCollapsed }"
                  @click.stop="toggleBranch(item.value)"
                />
                <span v-else-if="(item.depth ?? 0) > 0" class="w-3 flex-shrink-0" />
                <span v-if="item.emoji" class="flex-shrink-0 text-sm leading-none">{{ item.emoji }}</span>
                <UIcon
                  v-else-if="item.kind === 'folder'"
                  :name="item.hasChildren && !item.isCollapsed ? 'i-tabler-folder-open' : 'i-tabler-folder'"
                  class="w-4 h-4 flex-shrink-0 opacity-70"
                />
                <span
                  v-else-if="item.color"
                  class="w-2 h-2 rounded-full flex-shrink-0 transition-all"
                  :class="item.value === selectedBoardValue ? 'opacity-100' : 'opacity-60'"
                  :style="{ backgroundColor: item.color }"
                />
                <span class="truncate" :class="item.value === selectedBoardValue ? 'font-medium' : 'font-normal'">
                  {{ item.label }}
                </span>
              </span>
              <span class="flex items-center gap-1 flex-shrink-0">

                <UIcon
                  v-if="item.shared"
                  name="i-tabler-users"
                  class="w-3 h-3 opacity-50"
                  :title="isOwner(item) ? $t('boards.sidebar.shared') : $t('boards.sidebar.shared_by', { name: item.ownerName ?? $t('boards.someone') })"
                />

                <span v-if="item.kind !== 'folder'" class="text-xs opacity-50 group-hover/board:pr-1 transition-all">
                  {{ item.bookmarkCount ?? 0 }}
                </span>

                <!-- Collapsed to nothing until the row is hovered, so the count
                     keeps the right edge. -->
                <span class="flex items-center overflow-hidden max-w-0 opacity-0 group-hover/board:max-w-12 group-hover/board:opacity-100 focus-within:max-w-12 focus-within:opacity-100 transition-all">
                  <UButton
                    v-if="item.kind !== 'folder'"
                    size="2xs"
                    variant="ghost"
                    square
                    icon="i-tabler-share"
                    :aria-label="isOwner(item) ? $t('boards.sidebar.share_board') : $t('boards.share.people_with_access')"
                    class="rounded-md p-0.5"
                    :class="item.value === selectedBoardValue ? 'text-white hover:bg-white hover:text-neutral-900 dark:text-white dark:hover:bg-white dark:hover:text-neutral-900' : ''"
                    @click.stop="openShare(item)"
                  />
                  <!-- Settings, rules and delete are the owner's. -->
                  <UButton
                    v-if="isOwner(item)"
                    size="2xs"
                    variant="ghost"
                    square
                    icon="i-tabler-pencil"
                    :aria-label="item.kind === 'folder' ? $t('boards.sidebar.rename_folder') : $t('boards.sidebar.edit_board')"
                    class="rounded-md p-0.5"
                    :class="item.value === selectedBoardValue ? 'text-white hover:bg-white hover:text-neutral-900 dark:text-white dark:hover:bg-white dark:hover:text-neutral-900' : ''"
                    @click.stop="openEditBoard(item)"
                  />
                </span>
              </span>
            </span>
            </UContextMenu>
          </template>
        </UTabs>
      </div>
    </template>
  </UCollapsible>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { canDrop, planDrop } from '~/utils/boardTree'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const expanded = ref(true)

const store = useStore()
const { t } = useI18n()
const { fetchBoards, selectBoard, showAlert } = store
const { 
    boards, 
    activeBoard, 
    boardsLoaded, 
    boardsLoading, 
    showBoardModal, 
    boardToEdit, 
    typesFilter, 
    subTypesFilter,
    typeIsActive,
    draggedWebsite,
    draggedBoardId,
    sitesSelected
} = storeToRefs(store)

/**
 * Two kinds of drag land on a row.
 *
 * A bookmark card (it puts itself in `draggedWebsite`) dropped on a board adds
 * it there; folders take no bookmarks. A row from this list (`draggedBoardId`)
 * is moved: the top quarter of a row puts it before, the bottom quarter after,
 * the middle inside — if the row is a folder. Files dragged in from the
 * desktop are neither and still go to the upload overlay.
 */
const dropTargetId = ref(null)
const boardDrop = ref(null) // { id, zone } while a row is hovered mid-drag

const dropClass = (id) => {
  if (boardDrop.value?.id === id) {
    return {
      before: 'shadow-[inset_0_2px_0_0_var(--color-primary-500)]',
      after: 'shadow-[inset_0_-2px_0_0_var(--color-primary-500)]',
      inside: 'ring-2 ring-primary-500'
    }[boardDrop.value.zone]
  }
  return dropTargetId.value === id ? 'ring-2 ring-primary-500' : ''
}

let openTimer = null
const clearOpenTimer = () => { clearTimeout(openTimer); openTimer = null }

const zoneOf = (event, folder) => {
  const rect = event.currentTarget.getBoundingClientRect()
  const y = (event.clientY - rect.top) / rect.height
  if (y < (folder ? 0.25 : 0.5)) return 'before'
  if (y > (folder ? 0.75 : 0.5)) return 'after'
  return 'inside'
}

const onRowDragStart = (event, item) => {
  if (!isOwner(item)) return event.preventDefault()
  draggedBoardId.value = item.value
  event.dataTransfer.effectAllowed = 'move'
  // Firefox starts no drag without data; a private type keeps it from reading as a file or text.
  event.dataTransfer.setData('application/x-webbites-board', item.value)
}

const onRowDragEnd = () => {
  draggedBoardId.value = null
  boardDrop.value = null
  clearOpenTimer()
}

const onBoardDragOver = (event, item) => {
  if (draggedBoardId.value) {
    const target = boards.value.find(b => b.id === item.value)
    const zone = zoneOf(event, item.kind === 'folder')
    if (!target || !canDrop(boards.value, draggedBoardId.value, item.value, zone)) {
      boardDrop.value = null
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (boardDrop.value?.id !== item.value || boardDrop.value.zone !== zone) {
      boardDrop.value = { id: item.value, zone }
      clearOpenTimer()
      // Hovering a closed folder opens it, so a deep target can be reached in one drag.
      if (zone === 'inside' && item.isCollapsed) openTimer = setTimeout(() => store.expandBranch(item.value), 600)
    }
    return
  }
  if (!draggedWebsite.value?.objectId || item.kind === 'folder') return
  // A board shared for viewing takes nothing.
  if (item.role === 'viewer') return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dropTargetId.value = item.value
}

const onBoardDragLeave = (event, boardId) => {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (dropTargetId.value === boardId) dropTargetId.value = null
  if (boardDrop.value?.id === boardId) {
    boardDrop.value = null
    clearOpenTimer()
  }
}

const onBoardDrop = async (event, item) => {
  if (draggedBoardId.value) {
    const drop = boardDrop.value
    const dragId = draggedBoardId.value
    onRowDragEnd()
    if (!drop) return
    event.preventDefault()
    const plan = planDrop(boards.value, dragId, item.value, drop.zone)
    if (!plan) return
    if (drop.zone === 'inside') store.expandBranch(item.value)
    await store.reorderBoardsAction(plan.parentId, plan.orderedIds)
    return
  }

  const website = draggedWebsite.value
  dropTargetId.value = null
  if (!website?.objectId || item.role === 'viewer' || item.kind === 'folder') return
  event.preventDefault()

  try {
    const { addBookmarksToBoard } = useBoards()
    // Dragging one card of a multi-selection carries the whole selection.
    const grouped = sitesSelected.value.length > 1 && sitesSelected.value.some(s => s.objectId === website.objectId)
    const ids = grouped ? sitesSelected.value.map(s => s.objectId) : [website.objectId]
    const { created } = await addBookmarksToBoard(item.value, ids)
    const board = boards.value.find(b => b.id === item.value)
    if (board && created) board.bookmarkCount = (board.bookmarkCount ?? 0) + created
    showAlert({ message: created ? (created > 1 ? t('boards.added_bookmarks', { count: created, board: item.label }, created) : t('boards.added_to', { board: item.label })) : t('boards.already_in', { board: item.label }) })
  } catch (error) {
    console.error('Error adding bookmark to board:', error)
    showAlert({ message: t('boards.add_error'), type: 'danger' })
  }
}

/** Folders open or closed is a view state: per tab, in the store so a new folder can open its parent. */
const collapsed = computed(() => new Set(store.collapsedBranches))
const toggleBranch = (boardId) => store.toggleBranch(boardId)

/**
 * The boards in tree order — each parent followed by its children — with the
 * depth each row is drawn at.
 *
 * A flat, indented list rather than nested components: the vertical `UTabs`
 * slides one indicator between its rows, and it can only do that while they
 * are siblings in one list. Indentation is what says "inside", and the row
 * grammar stays identical at every level.
 *
 * `path` comes from the API and is the whole ancestry, so a board whose
 * parent is missing (not yet loaded, or archived) is drawn at the top level
 * rather than disappearing.
 */
const boardTabItems = computed(() => {
  const all = boards.value
  const byParent = new Map()
  const known = new Set(all.map(b => b.id))

  for (const board of all) {
    const parent = board.parentId && known.has(board.parentId) ? board.parentId : null
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(board)
  }
  // Boards shared with you come after your own: their sortIndex is the owner's.
  const mine = (b) => (b.role ?? 'owner') === 'owner' ? 0 : 1
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => mine(a) - mine(b) || (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
  }

  const items = []
  const walk = (parentId, depth) => {
    for (const board of byParent.get(parentId) ?? []) {
      const children = byParent.get(board.id) ?? []
      items.push({
        ...board,
        value: board.id,
        label: board.name,
        icon: undefined,
        emoji: board.icon,
        depth,
        hasChildren: children.length > 0,
        isCollapsed: collapsed.value.has(board.id)
      })
      if (children.length > 0 && !collapsed.value.has(board.id)) walk(board.id, depth + 1)
    }
  }
  walk(null, 0)
  return items
})
const selectorVisible = computed(() => {
  return typesFilter.value.length === 0 && subTypesFilter.value.length === 0 && typeIsActive.value === 'null'
})

const selectedBoardValue = computed({
  get() {
    return activeBoard.value?.id ?? '__none__'
  },
  set(value) {
    onBoardTabChange(value)
  }
})

const openCreateBoard = () => store.openNewBoardIn(null)

const onBoardTabChange = (boardId) => {
  const board = boards.value.find(b => b.id === boardId)
  // A folder has no contents to show: clicking it opens or closes it.
  if (board?.kind === 'folder') toggleBranch(board.id)
  else if (board) selectBoard(board)
}

onMounted(() => {
  if (!boardsLoaded.value && !boardsLoading.value) {
    fetchBoards()
  } else if (boardsLoaded.value) {
    // Boards came with the page (a deep-linked board) or survived a trip away
    // from /app, so fetchBoards never ran: start what it starts, and take up an
    // invitation opened meanwhile.
    store.startNotificationsPolling()
    store.acceptPendingInvite()
  }
})

const openEditBoard = (item) => {
  const board = boardOf(item)
  if (board.kind === 'folder') return store.openFolderModal(board)
  boardToEdit.value = board
  store.newBoardParentId = null
  showBoardModal.value = true
}

/** Boards from before sharing carry no `role`; they are the user's own. */
const isOwner = (board) => (board.role ?? 'owner') === 'owner'

// The tab item is a copy of the board with row fields on top; the modals and
// store actions want the board itself.
const boardOf = (item) => boards.value.find(b => b.id === item.value) ?? item

const openShare = (item) => store.openShareBoard(boardOf(item))

/**
 * Copy the board's public link. Fetched on demand — the list does not carry
 * it — so the clipboard write is handed a promise: Safari only accepts a write
 * that starts inside the click, not one that follows an `await`.
 */
const copyShareLink = async (item) => {
  const { getBoardSharing } = useBoards()
  const link = getBoardSharing(item.value).then(({ visibility, shareUrl }) => {
    if (visibility !== 'link' || !shareUrl) throw new Error('link sharing is off')
    return new Blob([shareUrl], { type: 'text/plain' })
  })
  try {
    if (typeof ClipboardItem !== 'undefined') await navigator.clipboard.write([new ClipboardItem({ 'text/plain': link })])
    else await navigator.clipboard.writeText(await (await link).text())
    showAlert({ message: t('boards.sidebar.link_copied') })
  } catch (error) {
    console.error('Error copying share link:', error)
    showAlert({ message: t('boards.sidebar.link_copy_error'), type: 'danger' })
  }
}

/** Right-click (long-press on touch) menu for a board row. */
const boardMenuItems = (item) => {
  if (item.kind === 'folder') {
    return [
      [
        { label: t('boards.sidebar.menu.new_board_here'), icon: 'i-tabler-layout-board', onSelect: () => store.openNewBoardIn(item.value) },
        { label: t('boards.sidebar.menu.new_folder_here'), icon: 'i-tabler-folder-plus', onSelect: () => store.openFolderModal(null, item.value) }
      ],
      [{ label: t('boards.sidebar.menu.rename'), icon: 'i-tabler-pencil', onSelect: () => openEditBoard(item) }],
      [{ label: t('boards.sidebar.menu.delete'), icon: 'i-tabler-trash', color: 'error', onSelect: () => store.deleteBoardAction(boardOf(item)) }]
    ]
  }
  const share = { label: isOwner(item) ? t('boards.sidebar.menu.share') : t('boards.sidebar.menu.people_with_access'), icon: 'i-tabler-share', onSelect: () => openShare(item) }

  if (!isOwner(item)) {
    return [
      [share],
      [{ label: t('boards.leave'), icon: 'i-tabler-logout', color: 'error', onSelect: () => store.leaveBoardAction(boardOf(item)) }]
    ]
  }

  return [
    [share, { label: t('boards.sidebar.menu.edit_board'), icon: 'i-tabler-pencil', onSelect: () => openEditBoard(item) }],
    [
      { label: t('boards.duplicate'), icon: 'i-tabler-copy', onSelect: () => store.duplicateBoardAction(boardOf(item)) },
      { label: t('boards.archive'), icon: 'i-tabler-archive', onSelect: () => store.archiveBoardAction(boardOf(item)) },
      ...(item.visibility === 'link'
        ? [{ label: t('boards.sidebar.menu.copy_share_link'), icon: 'i-tabler-link', onSelect: () => copyShareLink(item) }]
        : [])
    ],
    [{ label: t('boards.sidebar.menu.delete'), icon: 'i-tabler-trash', color: 'error', onSelect: () => store.deleteBoardAction(boardOf(item)) }]
  ]
}
</script>
