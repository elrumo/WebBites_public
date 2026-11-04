<template>
  <UModal v-model:open="showTrashModal">
    <template #content>
      <div class="flex flex-col max-h-[70vh]">
        <div class="p-5 pb-3 flex flex-col gap-1">
          <h5 class="m-0 font-semibold">{{ $t('boards.trash.title') }}</h5>
          <p class="m-0 text-sm opacity-60">
            {{ $t('boards.trash.description') }}
          </p>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
          <div v-if="trashLoading" class="empty">
            <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 opacity-40 animate-spin" />
          </div>

          <div v-else-if="trashedSites.length === 0" class="empty">
            <UIcon name="i-tabler-trash" class="w-8 h-8 opacity-30" />
            <p class="text-sm opacity-60 m-0">{{ $t('boards.trash.empty') }}</p>
          </div>

          <div
            v-for="site in trashedSites"
            :key="site.objectId"
            class="trash-row"
          >
            <div class="flex flex-row items-center gap-3 min-w-0">
              <img
                v-if="site.siteLogo"
                :src="site.siteLogo"
                alt=""
                class="size-6 rounded shrink-0 object-cover"
                loading="lazy"
              />
              <UIcon v-else name="i-heroicons-document" class="text-lg opacity-60 shrink-0" />
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium truncate">
                  {{ site.siteTitle || site.url || $t('boards.trash.untitled') }}
                </span>
                <span class="text-xs opacity-60">
                  {{ $t('boards.trash.purges_in', daysLeft(site.purgesAt) ?? 0) }}
                </span>
              </div>
            </div>
            <UButton
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-heroicons-arrow-uturn-left"
              @click="restoreItems([site.objectId])"
            >
              {{ $t('boards.trash.restore') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()
const { showTrashModal, trashedSites, trashLoading } = storeToRefs(store)
const { fetchTrash, restoreItems } = store

// Refetched every time the modal opens — a bookmark deleted since the last
// look should be in the list.
watch(showTrashModal, (open) => {
  if (open) fetchTrash()
}, { immediate: true })

const daysLeft = (purgesAt) => {
  if (!purgesAt) return null
  return Math.max(0, Math.ceil((new Date(purgesAt) - Date.now()) / 86400000))
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.trash-row {
  @apply flex flex-row items-center justify-between gap-3 px-3 py-2 rounded-lg;
  @apply hover:bg-neutral-100 dark:hover:bg-neutral-800;
}

.empty {
  @apply flex flex-col items-center justify-center gap-2 py-10;
}
</style>
