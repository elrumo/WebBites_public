<template> 
  <div class="bookmarks-area-wrapper">

    <MainSidebar/>

    <div
      class="bookmarks-area-container"
      :class="{
        'bookmarks-area-container--rss': isRssActive
      }"
    >
      <TopBar/>

      <!-- Feeds and bookmarks are separate reading surfaces, not two filters
           over one list, so the reader replaces the grid rather than sitting
           beside it. `rssScope` is the only switch. -->
      <!-- out-in: the reader leaves before the grid mounts, so a search from the
           top bar visibly swaps surfaces instead of stacking them. -->
      <Transition name="blur-in" mode="out-in">
        <div v-if="isRssActive" class="bookmark-area-wrapper w-full">
            <RssPane />
        </div>

        <div
            v-else
            class="bookmark-area-wrapper w-full"
            @drop="dropPinned($event, true)"
        >
            <BookmarkGroup
                groupTitle=""
                cardSize="regular"
            />
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
// import { mapState, mapActions, mapWritableState } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const store = useStore()

const canScrollLeft = ref(false)
const canScrollRight = ref(true)
const isDraggingOverPinned = ref(false)
const firstBookmark = ref('')


const {
  showWelcomeModal,
  isFirstTime,
  pinnedSites,
  draggedWebsite,
  scrolled,
  showSideBar,
  rssScope
} = storeToRefs(store)

const isRssActive = computed(() => rssScope.value !== null)

watch(isFirstTime, (val) => {
  showWelcomeModal.value = val
  firstBookmark.value = 'https://macosicons.com'
})

onMounted(() => {
  if (process.client) {
      const scrollWrapper = document.querySelector('.tags-filter-content')
      if(scrollWrapper) scrollWrapper.addEventListener('scroll', checkScrollTags)
  }
})

onUnmounted(() => {
  const scrollWrapper = document.querySelector('.tags-filter-content')
  if(scrollWrapper) {
      scrollWrapper.removeEventListener('scroll', checkScrollTags)
  }
})

function dropPinned(event, unpin = false) {
  let droppedOnBookmarkGrid = false
  let count = 0

  if(!draggedWebsite.value) return

  console.log('event: ', event.target)

  let currentElement = event.target
  while (currentElement && !droppedOnBookmarkGrid) {
      droppedOnBookmarkGrid = currentElement.classList.contains('bookmark-group-wrapper') || currentElement.classList.contains('bookmark-group-container')
      currentElement = currentElement.parentElement
      count++
      if(count > 50) return
  }

  try {
      isDraggingOverPinned.value = false
      if(droppedOnBookmarkGrid || pinnedSites.value.map((site) => site.objectId).includes(draggedWebsite.value.objectId)) {
          if(unpin) {
              store.setPin(draggedWebsite.value, false)
              console.log('unpinned 333')
              return
          }

          store.showAlert({ message: t('bookmarks_area.already_pinned') })
          return
      }
      console.log('pinned 340')
      store.setPin(draggedWebsite.value)
  } catch (error) {
  }
}

function checkScrollTags(el) {
  canScrollLeft.value = el.target.scrollLeft > 30

  const scrollWrapper = document.querySelector('.tags-filter-content')
  const scrollAmount = scrollWrapper.scrollWidth - scrollWrapper.clientWidth
  canScrollRight.value = el.target.scrollLeft < scrollAmount - 30
}

</script>


<style>
</style>
