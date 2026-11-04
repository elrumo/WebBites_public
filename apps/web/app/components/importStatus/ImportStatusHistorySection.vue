<template>
  <div class="px-2 md:min-w-[420px]">
    <h4 v-if="totalSessions > 0" class="text-sm font-medium text-gray-900 dark:text-white mb-3">
      {{ $t('import_status_history.title', { count: totalSessions }, totalSessions) }}
    </h4>
    
    <div 
      v-if="sessions.length === 0 && !statusData?.isImporting"
      class="flex flex-col items-center justify-center text-sm text-gray-500 dark:text-gray-400 w-full text-center"
    >
      {{ $t('import_status_history.empty') }}

      <UButton
        @click="store.clickId('importBookmarks')"
        color="neutral" variant="solid"
        class="flex justify-center rounded-lg w-fit mt-2"
      >
        <input 
          @change="store.importBookmarksFile()" 
          id="importBookmarks" 
          type="file" 
          class="hidden absolute"
          accept=".json,.txt,.html, .csv"
        >
        {{ $t('bookmarks.import') }}
      </UButton>
    </div>
    
    <div v-else class="space-y-3">
      <div v-for="session in sessions.slice(0, 5)" :key="session.id" class="well !p-3 !border-opacity-50	shadow-sm">
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ formatDate(session.date) }}
            </p>
            <p class="text-xs text-gray-600 dark:text-gray-300">
              {{ $t('import_status_history.progress', { processed: session.processed, total: session.total }) }}
              <span v-if="session.total > 0 && session.successRate"> • {{ $t('import_status_history.success_rate', { rate: session.successRate.toFixed(1) }) }}</span>
            </p>

            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span v-if="session.duration">{{ $t('import_status_history.duration', { duration: formatDuration(session.duration) }) }}</span>
              <!-- <span v-if="session.avgRate > 0">Rate: {{ session.avgRate.toFixed(1) }}/min</span> -->
              <!-- <span v-if="session.accessType" class="capitalize">{{ session.accessType.replace('-', ' ') }}</span> -->
            </div>

            <!-- <div v-if="session.batchId" class="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Batch: {{ session.batchId }}
            </div> -->
          </div>
          <!-- <UButton
            @click="showFailedId.length > 0 ? showFailedId = '' : showFailedId = session.id"
            size="2xs"
            variant="ghost"
            color="red"
            class="mr-2 -mt-0.5 text-opacity-50"
          >
            View failed
          </UButton> -->

          <UBadge 
            :color="getStatusColor(session.status)"
            :label="statusLabel(session.status)"
            class="capitalize opacity-70"
            size="xs"
          />
          <!-- <UBadge 
            v-if="session.status === 'completed' && session.total > 0"
            :color="session.successRate >= 95 ? 'green' : session.successRate >= 80 ? 'yellow' : 'red'"
            :label="`${session.successRate.toFixed(0)}%`"
            size="xs"
          /> -->
        </div>

        <!-- <div v-if="showFailedId === session.id">
          {{ session.failed }} failed bookmarks
        </div> -->
      </div>
      
      <div v-if="totalSessions > 5" class="text-xs text-gray-500 dark:text-gray-400 text-center">
        {{ $t('import_status_history.more_sessions', { count: totalSessions - 5 }, totalSessions - 5) }}
      </div>

    </div>
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';

const store = useStore();
const { t } = useI18n();

const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  statusData: {
    type: Object,
    default: () => ({})
  },
  totalSessions: {
    type: Number,
    default: 0
  }
})

const showFailedId = ref('');

function formatDuration(milliseconds) {
  if (!milliseconds) return '0s'
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function formatDate(date) {
  if (!date) return t('import_status_history.unknown')
  
  // Handle Parse Date format with iso property
  const dateObj = date.iso ? new Date(date.iso) : new Date(date)
  
  return dateObj.toLocaleDateString([], { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: '2-digit', 
    minute: '2-digit' 
  })
}

const knownStatuses = ['completed', 'active', 'failed', 'cancelled']

function statusLabel(status) {
  return knownStatuses.includes(status) ? t(`import_status_history.status.${status}`) : status
}

function getStatusColor(status) {
  switch (status) {
    case 'completed':
      return 'green'
    case 'active':
      return 'blue'
    case 'failed':
      return 'red'
    case 'cancelled':
      return 'gray'
    default:
      return 'gray'
  }
}
</script>