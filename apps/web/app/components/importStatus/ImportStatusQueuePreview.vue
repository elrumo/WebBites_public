<template>
  <div class="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
    <div class="flex justify-between items-center mb-3">
      <h4 class="text-sm font-medium text-gray-900 dark:text-white">{{ $t('import_export.queue.title') }}</h4>
      <span class="text-sm text-gray-500 dark:text-gray-400">{{ $t('import_export.queue.remaining', { count: totalRemaining }) }}</span>
    </div>
    
    <div class="space-y-2">
      <div v-if="upcoming.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
        {{ $t('import_export.queue.empty') }}
      </div>
      
      <div v-for="(item, index) in upcoming" :key="index" class="flex items-center space-x-2">
        <div class="flex-shrink-0 w-6 h-6 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
          <span class="text-xs font-medium text-blue-600 dark:text-blue-300">{{ index + 1 }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <span class="text-sm text-gray-600 dark:text-gray-300 truncate block">{{ item.displayUrl || item.url }}</span>
          <div v-if="item.importBatch" class="text-xs text-gray-400 dark:text-gray-500">
            {{ $t('import_export.queue.batch', { batch: item.importBatch }) }}
          </div>
        </div>
      </div>
      
      <div v-if="totalRemaining > 5" class="text-xs text-gray-500 dark:text-gray-400">
        {{ $t('import_export.queue.more', { count: totalRemaining - 5 }) }}
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  upcoming: {
    type: Array,
    default: () => []
  },
  totalRemaining: {
    type: Number,
    default: 0
  },
  recentlyProcessed: {
    type: Number,
    default: 0
  }
})
</script>