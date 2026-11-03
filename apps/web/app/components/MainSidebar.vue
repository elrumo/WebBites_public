<template>
  <!-- Phone: the sidebar floats over the grid, so a tap on the grid behind it
       is the way back — the same as swiping the native drawer shut. -->
  <Transition name="fade">
    <div
      v-if="showSideBar"
      class="sidebar-scrim"
      @click="showSideBar = false"
    />
  </Transition>

  <div
    class="bookmark-area-sidebar"
    :class="{ 'sidebar-collapsed': !showSideBar }"
  >
    <div class="bookmark-area-body">
      <div class="bookmark-sidebar-group">

        <div class="bookmark-sidebar-list pt-1">
          <BookmarkTypes :horizontal="false"/>
        </div>
      </div>

      <div class="bookmark-sidebar-group">
        <BoardsSidebarBoardsList />
      </div>

      <div class="bookmark-sidebar-group">
        <RssSidebarFeedsList />
      </div>

      <!-- Pinned to the bottom of the sidebar. -->
      <div class="bookmark-sidebar-group mt-auto pb-4">
        <!-- Private sits down here with Trash rather than up with the type
             filters: both are places the grid goes rather than filters over
             it, and neither belongs in the everyday browsing row. -->
        <button
          type="button"
          class="sidebar-trash-button"
          :class="{ 'sidebar-trash-button--active': privateScope }"
          @click="openPrivate"
        >
          <UIcon
            :name="privateScope ? 'i-tabler-lock-open' : 'i-tabler-lock'"
            class="w-4 h-4 flex-shrink-0"
          />
          <span class="truncate">{{ $t('bookmarks.hide.private_section') }}</span>
        </button>
        <button
          type="button"
          class="sidebar-trash-button"
          @click="showTagManagerModal = true"
        >
          <UIcon name="i-tabler-tags" class="w-4 h-4 flex-shrink-0" />
          <span class="truncate">{{ $t('tags.manage') }}</span>
        </button>
        <button
          type="button"
          class="sidebar-trash-button"
          @click="showTrashModal = true"
        >
          <UIcon name="i-tabler-trash" class="w-4 h-4 flex-shrink-0" />
          <span class="truncate">{{ $t('main_sidebar.trash') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()
const {
  scrolled,
  showSideBar,
  showTrashModal,
  showTagManagerModal,
  privateScope,
  privateUnlocked,
  showPrivateUnlockModal,
} = storeToRefs(store)

/**
 * Toggle the Private section, asking for the password the first time.
 *
 * The unlock lasts for this tab and no longer — deliberately not persisted, so
 * closing the browser re-locks. Leaving the section does not re-lock, or
 * stepping into a board and back would ask again every time.
 */
const openPrivate = () => {
  if (privateScope.value) {
    store.exitPrivateScope()
    return
  }
  if (privateUnlocked.value) {
    store.enterPrivateScope()
    return
  }
  showPrivateUnlockModal.value = true
}
</script>

<style>
@reference "../assets/css/tailwind.css";

/* Desktop keeps the sidebar in the row, so there is nothing to dismiss. */
.sidebar-scrim{
  @apply hidden;

  @media screen and (max-width: 768px){
    @apply
      block fixed inset-0
      z-[7]
      bg-neutral-900/20 dark:bg-black/40
      backdrop-blur-[2px]
    ;
  }
}

.bookmark-area-sidebar{
  @apply
    flex flex-col h-full
    sticky top-8
    mt-6
    pt-16
    gap-2
    rounded-xl 
    h-full
    transition-all
    max-h-[90vh]
    z-[2]
    /* w-[230px] */
    
    /* !px-4
    ring ring-1 ring-neutral-200/50 dark:ring-neutral-700/50
    bg-white/50
    shadow-lg
    shadow-neutral-500/10 dark:shadow-black/30 */
  ;
}

.bookmark-area-body{
  @apply
    flex flex-col gap-4
    h-full
    min-h-0 overflow-y-auto overscroll-contain
    w-[230px] pl-4
    transition-all
  ;
}

/* Desktop: collapsing takes the column out of the row so the grid reclaims it.
   The column goes to zero width but stays a flex item, so the row's `gap-4`
   would still push the grid 1rem right of where the wrapper's padding ends —
   enough to leave the sidebar trigger further from the left edge than the
   settings island is from the right. The negative margin eats that gap back,
   and rides the same transition. */
.bookmark-area-sidebar.sidebar-collapsed{
  @apply -mr-4;
}

.bookmark-area-sidebar.sidebar-collapsed .bookmark-area-body{
  @apply -translate-x-full opacity-0 w-0 pl-0;
}

/* Mobile: the sidebar floats over the grid instead of squeezing it. */
@media screen and (max-width: 768px){
  .bookmark-area-sidebar{
    @apply
      fixed left-0 top-0 bottom-0
      mt-0
      pt-0
      max-h-none
      z-[8]
      pointer-events-none
    ;
  }

  .bookmark-area-body{
    /* No floating trigger to clear here — the sidebar opens from the mobile
       header — so the list starts just under the status bar. */
    padding-top: calc(env(safe-area-inset-top, 0px) + 1rem);

    @apply
      w-[230px] pl-4 pr-2 pb-8
      overflow-y-auto overscroll-contain
      pointer-events-auto
      rounded-r-2xl
      bg-neutral-50 dark:bg-neutral-800
      shadow-xl shadow-neutral-900/10 dark:shadow-black/40
    ;
  }

  .bookmark-area-sidebar.sidebar-collapsed .bookmark-area-body{
    @apply -translate-x-full opacity-0 w-[230px] pl-4 pointer-events-none;
  }
}

.bookmark-sidebar-group{
  @apply flex flex-col gap-1;

  .label{
    @apply m-0 text-xs font-medium opacity-50;
  }
}

.bookmark-sidebar-list{
  @apply flex flex-col gap-1 flex-1;
}

.sidebar-trash-button{
  @apply
    flex flex-row items-center gap-2
    w-full px-2 h-7
    text-sm text-gray-500
    rounded-lg
    transition-colors
    hover:bg-neutral-200 dark:hover:bg-neutral-700/60
  ;
}

.sidebar-trash-button--active{
  @apply bg-neutral-600 dark:bg-neutral-950 text-white;
}
</style>
