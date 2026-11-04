<template>
  <div class="well">
    <div class="flex items-center justify-between mb-2">
      <h4 class="text-sm font-medium">{{ $t('import_export.overview.title') }}</h4>
      <UBadge 
        :color="(status === 'active' || status === 'processing') ? 'green' : status === 'completed' ? 'blue' : 'gray'"
        :label="statusLabel"
      />
    </div>
    
    <div v-if="isImporting" class="text-sm text-gray-600 dark:text-gray-300">
      <p>{{ $t('import_export.overview.processing', { done: progress.processed + progress.failed, total: progress.total }) }}</p>
      <p v-if="currentUrl" class="mt-1 truncate">{{ $t('import_export.overview.currently', { url: currentUrl }) }}</p>
      <!-- <p v-if="lastUpdate" class="mt-1 text-xs">
        Last update: {{ formatTimeAgo(lastUpdate) }}
      </p> -->
    </div>
    
    <div v-else class="text-sm text-gray-600 dark:text-gray-300">
      <p>{{ $t('import_export.overview.no_session') }}</p>
    </div>
  </div>
</template>

<script setup>
const { t, te } = useI18n()

const props = defineProps({
  status: {
    type: String,
    default: 'inactive'
  },
  isImporting: {
    type: Boolean,
    default: false
  },
  progress: {
    type: Object,
    default: () => ({
      processed: 0,
      failed: 0,
      total: 0,
      percentage: 0
    })
  },
  currentUrl: {
    type: String,
    default: null
  },
  lastUpdate: {
    type: [String, Date],
    default: null
  }
})

const statusLabel = computed(() =>
  te(`import_export.status_labels.${props.status}`)
    ? t(`import_export.status_labels.${props.status}`)
    : props.status.charAt(0).toUpperCase() + props.status.slice(1)
)

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