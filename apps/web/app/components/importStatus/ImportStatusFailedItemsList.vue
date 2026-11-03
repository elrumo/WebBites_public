<template>
  <div class="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
    <div class="flex justify-between items-center mb-3">
      <h4 class="text-sm font-medium text-red-600 dark:text-red-400">
        {{ $t('import_export.failed.title', { count: totalFailed }) }}
      </h4>
      <UButton
        v-if="retryableCount > 0"
        color="red"
        variant="outline"
        size="xs"
        @click="$emit('retryFailed')"
      >
        {{ $t('import_export.failed.retry', { count: retryableCount }, retryableCount) }}
      </UButton>
    </div>
    
    <div class="space-y-2 max-h-48 overflow-y-auto">
      <div v-for="(failure, index) in items" :key="index" class="p-2 bg-red-50 dark:bg-red-900/20 rounded">
        <div class="flex justify-between items-start">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ failure.displayUrl }}</p>
            <p class="text-xs text-red-600 dark:text-red-400">{{ failure.error }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ formatTimeAgo(failure.timestamp) }} • {{ failure.processingTime }}ms
            </p>
          </div>
          <UBadge 
            :color="failure.canRetry ? 'orange' : 'red'"
            :label="failure.canRetry ? $t('import_export.failed.retryable') : $t('import_export.failed.failed')"
            size="xs"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
const { t } = useI18n()

defineEmits(['retryFailed'])

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  totalFailed: {
    type: Number,
    default: 0
  },
  retryableCount: {
    type: Number,
    default: 0
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