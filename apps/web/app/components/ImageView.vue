<template>
  <div class="image-view-wrapper" v-if="imageUrls.length">
    <vue-easy-lightbox
      :key="lightboxKey"
      :visible="visible"
      :imgs="imageUrls"
      :index="currentIndex"
      :moveDisabled="false"
      :enableZoom="true"
      :pinchZoomEnabled="true"
      ref="lightbox"
      @on-index-change="onIndexChange"
    >
      <template v-slot:close-btn="{ close }">
      </template>

      <template v-slot:toolbar="{ toolbarMethods, imgIndex }">
        <!-- Sits just above the thumbnail strip when there is one; the strip is a
             sibling of the lightbox, so its height has to be measured. -->
        <div
          class="bubble-menu-wrapper absolute left-1/2 bottom-[2.4rem] md:bottom-5 -translate-x-1/2"
          :style="stripHeight ? { bottom: `${stripHeight + 8}px` } : undefined"
        >
          <UButton size="sm" variant="ghost" icon="i-heroicons-magnifying-glass-plus" @click="toolbarMethods.zoomIn"/>
          <UButton size="sm" variant="ghost" icon="i-heroicons-magnifying-glass-minus" @click="toolbarMethods.zoomOut"/>
          <UButton size="sm" variant="ghost" icon="i-heroicons-arrows-pointing-in" @click="toolbarMethods.resize" />
          <UButton size="sm" variant="ghost" icon="i-tabler-rotate-2" @click="toolbarMethods.rotateLeft"/>
          <UButton size="sm" variant="ghost" icon="i-tabler-rotate-clockwise-2" @click="toolbarMethods.rotateRight"/>
        </div>
      </template>
    </vue-easy-lightbox>

    <img class="image-bg" :src="imageUrls[currentIndex] || imageUrls[0]" alt="">

    <div v-if="images.length > 1" ref="strip" class="image-view-strip">
      <span class="image-view-counter">
        {{ $t('bookmarks.image_n_of_m', { n: currentIndex + 1, m: images.length }) }}
      </span>
      <BookmarkImageStrip
        :model-value="images"
        :current="currentIndex"
        @update:model-value="saveOrder"
        @select="currentIndex = $event"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { bookmarkImages } from '~/composables/useBookmarkImages'

const store = useStore()
const visible = ref(true)
const lightbox = ref(null)
const currentIndex = ref(0)
const strip = ref(null)
const { height: stripHeight } = useElementSize(strip)

const { webToShow } = storeToRefs(store)

// Every picture on the bookmark. A single-image bookmark has no `images` array
// and reads as the one-item list [cover], so there is no branch here.
const images = computed(() => bookmarkImages(webToShow.value))
const imageUrls = computed(() => images.value.map((image) => image.url))

// vue-easy-lightbox takes `index` as a starting value only, so a reorder has to
// remount it to land on the right picture.
const lightboxKey = ref(0)

watch(() => webToShow.value?.objectId, () => {
  currentIndex.value = 0
  lightboxKey.value++
})

function onIndexChange(_oldIndex, newIndex) {
  currentIndex.value = newIndex
}

/**
 * Persist the new order. Only `images` is written: the cloud beforeSave trigger
 * mirrors images[0].url onto OGImage, so the grid thumbnail follows the cover
 * without this component knowing anything about it.
 */
async function saveOrder(next) {
  const id = webToShow.value?.objectId
  if (!id) return

  const previous = webToShow.value.images
  // Optimistic: the modal and the strip should move under the user's finger.
  webToShow.value.images = next
  if (next[0]?.url) webToShow.value.OGImage = next[0].url
  lightboxKey.value++

  try {
    await store.saveUpdatedSite(id, 'images', next)
  } catch (error) {
    console.error('error saving image order: ', error)
    webToShow.value.images = previous
  }
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.image-view-strip {
  @apply absolute bottom-0 inset-x-0 z-20 flex flex-col items-center gap-1;
  @apply px-3 pb-2 pt-6 bg-gradient-to-t from-black/70 to-transparent;
}

.image-view-counter {
  @apply text-xs text-white/80 tabular-nums;
}
</style>
