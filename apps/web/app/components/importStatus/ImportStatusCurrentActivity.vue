<template>
  <div class="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
    <div class="flex items-center space-x-3">
      <div v-if="url" class="flex items-center space-x-2">
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
        <div class="flex-1 w-full">
          <p class="text-sm font-medium text-gray-900 dark:text-white">{{ $t('import_export.activity.processing') }}</p>
          <p class="text-sm text-gray-600 dark:text-gray-300 truncate max-w-[160px] md:max-w-[360px]">{{ url }}</p>
        </div>
      </div>
      
      <div v-else class="flex items-center space-x-2">
        <div class="h-4 w-4 rounded-full bg-gray-300 dark:bg-gray-600" />
        <p class="text-sm text-gray-600 dark:text-gray-300">{{ $t('import_export.activity.waiting') }}</p>
      </div>
    </div>
    
    <div v-if="lastUpdate" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
      {{ $t('import_export.activity.last_update', { time: formatTimeAgo(lastUpdate) }) }}
    </div>
  </div>
</template>

<script setup>
const { t } = useI18n()

const props = defineProps({
  url: {
    type: String,
    default: null
  },
  lastUpdate: {
    type: [String, Date],
    default: null
  }
})

function formatTimeAgo(date) {
  if (!date) return t('import_export.time.unknown')
  const now = new Date()
  const diff = now - new Date(date)
  const minutes = Math.floor(diff / 60000)
  const seconds = Math.floor(diff / 1000) % 60
  
  if (minutes > 0) {
    return t('import_export.time.ago_minutes', { minutes, seconds })
  }
  return t('import_export.time.ago_seconds', { seconds })
}
</script>