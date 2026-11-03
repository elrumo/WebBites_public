<template>
    <div class="pinned-area">
        <div class=" flex flex-row items-center">
          <UButton
              @click="isExpanded = !isExpanded"
              color="neutral"
              :variant="isExpanded ? 'ghost' : 'solid'"
              class="mb-2 w-full md:w-fit px-2 py-2 sm:px-2 sm:py-1 flex flex-row items-center justify-center gap-1"
          >
            <UIcon
                name="i-tabler-pin-filled"
                class="w-5 h-5 text-yellow-600"
            />
            <h3 class="text-sm font-medium text-neutral-500 dark:text-neutral-200">
                {{ $t('bookmarks.pinned') }}
            </h3>
            <UIcon
                :name="isExpanded ? 'i-tabler-chevron-up' : 'i-tabler-chevron-down'"
                class="w-4 h-4"
            />
          </UButton>
        </div>

        <TransitionExpand>
          <div v-if="isExpanded" class="pinned-sites-wrapper">
            <div
                v-if="pinnedSites.length > 0"
                class="pinned-items-container"
            >
            <TransitionGroup name="slide-up">
                  <BookmarkCard
                    class="relative"
                    v-for="site in pinnedSites"
                    :key="site.objectId"
                    :website="site"
                    :isPinned="true"
                  />
                </TransitionGroup>
              </div>

              <div v-else class="w-full flex items-center">
                <h2 class="m-auto w-fit opacity-70">
                  {{ $t('bookmarks.no_pinned_bookmarks') }}
                </h2>
              </div>
          </div>
        </TransitionExpand>
    </div>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';
import { ref } from 'vue';

const store = useStore();
const { pinnedSites } = storeToRefs(store);
const isExpanded = ref(false);
</script>
