<template>
  <div class="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
    <h4 class="text-sm font-medium text-gray-900 dark:text-white mb-3">{{ $t('import_export.metrics.title') }}</h4>
    
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="text-center">
        <p class="text-2xl font-semibold text-blue-500">{{ processingRate.toFixed(1) }}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('import_export.metrics.per_minute') }}</p>
      </div>
      
      <div class="text-center">
        <p class="text-2xl font-semibold text-green-500">{{ formatDuration(duration) }}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('import_export.metrics.duration') }}</p>
      </div>
      
      <div class="text-center">
        <p class="text-2xl font-semibold text-purple-500">
          {{ estimatedCompletion ? formatTime(estimatedCompletion) : '--:--' }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('import_export.metrics.estimated_completion') }}</p>
      </div>
      
      <div v-if="batchInfo" class="text-center">
        <p class="text-2xl font-semibold text-orange-500">{{ batchInfo.current }}/{{ batchInfo.total }}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('import_export.metrics.batches') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
const { t } = useI18n()

const props = defineProps({
  processingRate: {
    type: Number,
    default: 0
  },
  startTime: {
    type: [String, Date],
    default: null
  },
  estimatedCompletion: {
    type: [String, Date],
    default: null
  },
  duration: {
    type: Number,
    default: 0
  },
  batchInfo: {
    type: Object,
    default: null
  }
})

function formatDuration(milliseconds) {
  if (!milliseconds) return t('import_export.time.seconds', { seconds: 0 })
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) {
    return t('import_export.time.hours_minutes', { hours, minutes: minutes % 60 })
  }
  if (minutes > 0) {
    return t('import_export.time.minutes_seconds', { minutes, seconds: seconds % 60 })
  }
  return t('import_export.time.seconds', { seconds })
}

function formatTime(date) {
  if (!date) return '--:--'
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>