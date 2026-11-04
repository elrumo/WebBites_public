<template>
  <div class="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700 overflow-hidden max-w-[100%]">
    
    <div class="flex flex-col gap-2 items-start mb-2">
      <div class="flex flex-row gap-2 items-center">
        <span class="text-sm font-medium text-gray-900 dark:text-white">{{ $t('import_export.progress.title') }}</span>
        <div class="animate-spin rounded-full size-3 border-b-2 border-green-500" />
      </div>

      <small class="text-sm opacity-80">
        {{ $t('import_export.progress.hint') }}
      </small>
    </div>
    
    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
      <div 
        class="h-3 rounded-full transition-all duration-500 ease-out"
        :class="{
          'bg-green-500': failed === 0,
          'bg-gradient-to-r from-green-500 to-red-400': failed > 0
        }"
        :style="{ width: `${percentage}%` }"
      />
    </div>
    
    <div class="w-full flex flex-row justify-between items-start mt-1.5">
      <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{{ $t('import_export.progress.completed', { count: processed }) }}</span>
        <span v-if="failed > 0" class="text-red-500 pl-2">{{ $t('import_export.progress.failed', { count: failed }) }}</span>
      </div>

      <span class="text-xs text-gray-600 dark:text-gray-300">
        {{ processed + failed }} / {{ total }} ({{ percentage.toFixed(1) }}%)
      </span>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  processed: {
    type: Number,
    default: 0
  },
  failed: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    default: 0
  },
  percentage: {
    type: Number,
    default: 0
  }
})
</script>