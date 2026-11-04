<template>
  <UModal v-model:open="showImportStatusModal" :ui="{ content: 'sm:max-w-2xl' }">
  <template #content>
    <div class="p-4">
      <div class="max-h-[80vh] w-full overflow-auto">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ $t('import_export.modal.title') }}
          </h3>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-heroicons-x-mark-20-solid"
            @click="showImportStatusModal = false"
          />
        </div>

<!-- Using centralized importStatus from store -->
        <!-- {{ statusData }} -->

        <!-- Status Overview -->
        <ImportStatusOverview 
          v-if="!statusData.isImporting && historyData.totalSessions > 0"
          :status="statusData.status"
          :isImporting="statusData.isImporting"
          :progress="statusData.progress"
          :currentUrl="statusData.currentUrl"
          :lastUpdate="statusData.lastUpdate"
        />

        <!-- Progress Section (only shown when importing) -->
        <div v-if="statusData.isImporting" class="space-y-4 mt-4">
          <ImportStatusProgressBar 
            :processed="statusData.progress.processed"
            :failed="statusData.progress.failed"
            :total="statusData.progress.total"
            :percentage="statusData.progress.percentage"
          />

          <!-- <ImportStatusCurrentActivity 
            :url="statusData.currentUrl"
            :lastUpdate="statusData.lastUpdate"
          /> -->

          <!-- <ImportStatusMetricsPanel 
            :processingRate="metricsData.processingRate"
            :startTime="metricsData.startTime"
            :estimatedCompletion="metricsData.estimatedCompletion"
            :duration="metricsData.duration"
            :batchInfo="metricsData.batchInfo"
          /> -->

          <!-- <ImportStatusQueuePreview 
            :upcoming="queueData.upcoming"
            :totalRemaining="queueData.totalRemaining"
            :recentlyProcessed="queueData.recentlyProcessed"
          /> -->
        </div>

        <!-- History Section -->
        <ImportStatusHistorySection 
          :sessions="historyData.sessions"
          :statusData="statusData"
          :totalSessions="historyData.totalSessions"
          class="mt-6"
        />

        <!-- Failed Items List -->
        <!-- <ImportStatusFailedItemsList 
          v-if="failuresData.items && failuresData.items.length > 0"
          :items="failuresData.items"
          :totalFailed="failuresData.totalFailed"
          :retryableCount="failuresData.retryableCount"
          @retryFailed="retryFailedItems"
          class="mt-6"
        /> -->
      </div>

        <!-- Action Buttons -->
      <div class="flex justify-between items-center mt-6">
        <div class="flex space-x-3">
          <!-- <UButton
            v-if="failuresData.retryableCount && failuresData.retryableCount > 0"
            color="orange"
            variant="outline"
            @click="retryFailedItems"
          >
            Retry {{ failuresData.retryableCount }} Failed Items
          </UButton> -->
          
          <UButton
            v-if="statusData.isImporting"
            color="red"
            variant="ghost"
            :loading="cancelling"
            :disabled="cancelling"
            @click="cancelImport"
          >
            {{ $t('import_export.modal.cancel_import') }}
          </UButton>
        </div>

        <UButton
          color="neutral"
          variant="solid"
          @click="showImportStatusModal = false"
        >
          {{ $t('common.close') }}
        </UButton>
      </div>
    </div>
  
  </template>
</UModal>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import Parse from 'parse'

// Initialize router and route once outside the watcher for better performance
const router = useRouter()
const route = useRoute()

const store = useStore()
const { t } = useI18n()

const {
  showImportStatusModal,
  importStatus
} = storeToRefs(store);

// Centralized import status comes from store (LiveQuery subscriptions handled in store)

// Computed properties for component data
const processingSessionFromHistory = computed(() =>
  (importStatus.value.history || []).find(s => s.status === 'processing')
)

const displaySession = computed(() => importStatus.value.session || processingSessionFromHistory.value || null)

const statusData = computed(() => ({
  status: displaySession.value?.status || 'inactive',
  isImporting: importStatus.value.isActive || !!processingSessionFromHistory.value,
  progress: {
    processed: displaySession.value?.processedBookmarks || 0,
    failed: displaySession.value?.failedBookmarks || 0,
    total: displaySession.value?.totalBookmarks || 0,
    percentage: displaySession.value && displaySession.value.totalBookmarks
      ? (displaySession.value.processedBookmarks / displaySession.value.totalBookmarks * 100)
      : 0
  },
  currentUrl: displaySession.value?.currentlyProcessing,
  lastUpdate: displaySession.value?.lastProgressUpdate
}))

const metricsData = computed(() => ({
  processingRate: importStatus.value.session?.processingRate || 0,
  startTime: importStatus.value.session?.startedAt,
  estimatedCompletion: importStatus.value.session?.estimatedCompletion,
  batchInfo: importStatus.value.session?.batchInfo
    ? {
        current: importStatus.value.session.batchInfo.currentBatch,
        total: importStatus.value.session.batchInfo.totalBatches,
        batchProgress:
          (importStatus.value.session.batchInfo.currentBatch /
            importStatus.value.session.batchInfo.totalBatches) * 100
      }
    : null,
  duration: importStatus.value.session
    ? new Date() - new Date(importStatus.value.session.startedAt)
    : 0
}))

const queueData = computed(() => ({
  upcoming: [],
  totalRemaining: Number(importStatus.value.remaining || 0),
  recentlyProcessed: importStatus.value.session?.processedBookmarks || 0
}))

const failuresData = computed(() => {
const failures = importStatus.value.session?.errors || []

  return {
    items: failures.map((failure) => {
      const url = failure?.url || ''
      return {
        url,
        error: failure?.error,
        timestamp: failure?.timestamp,
        processingTime: failure?.processingTime,
        canRetry: failure?.canRetry || false,
        displayUrl: url && url.length > 50 ? url.substring(0, 50) + '...' : url
      }
    }),
    totalFailed: failures.length,
    retryableCount: failures.filter((f) => f?.canRetry).length
  }
})

const historyData = computed(() => ({
sessions: (importStatus.value.history || []).map(session => ({
    id: session.sessionId || session.batchId,
    batchId: session.batchId,
    date: session.startedAt,
    duration: session.completedAt ? new Date(session.completedAt.iso || session.completedAt) - new Date(session.startedAt.iso || session.startedAt) : null,
    processed: session.processedBookmarks || 0,
    failed: session.failedBookmarks || 0,
    total: session.totalBookmarks || 0,
    successRate: session.totalBookmarks ? (session.processedBookmarks / session.totalBookmarks * 100) : 0,
    avgRate: session.processingRate || 0,
    status: session.status,
    accessType: session.accessType
  })),
  totalSessions: (importStatus.value.history || []).length
}))

// Data fetching functions

// Action handlers
async function retryFailedItems() {
  try {
    const user = Parse.User.current()
    if (!user) return

    const retryableItems = (importStatus.value.failures || []).filter(f => f.canRetry)
    const retryUrls = retryableItems.map(item => item.url)
    
    // Create new bookmarksToImport objects for retry
    const BookmarksToImport = Parse.Object.extend('bookmarksToImport')
    const savePromises = retryUrls.map(url => {
      const bookmarkObject = new BookmarksToImport()
      return bookmarkObject.save({
        user: user,
        url: url,
        importBatch: `retry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      })
    })
    
    await Promise.all(savePromises)
    
    // Clear retryable failed items
    const nonRetryableFailures = (importStatus.value.failures || []).filter(f => !f.canRetry)
    user.set('failedToImport', nonRetryableFailures)
    
    await user.save()
    
    store.showAlert({ 
      message: t('import_export.modal.retry_success', retryUrls.length),
      type: 'success'
    })
    
    await store.refreshImportStatus()
  } catch (error) {
    console.error('Error retrying failed items:', error)
    store.showAlert({ 
      message: t('import_export.modal.retry_error'),
      type: 'error'
    })
  }
}

const cancelling = ref(false)

async function cancelImport() {
  const user = Parse.User.current()
  if (!user || cancelling.value) return

  cancelling.value = true
  // Set before the request: the backend's user update can arrive first
  store.importCancelled = true
  try {
    // The backend cancels the session and clears the queue with the master key,
    // so already-queued messages are skipped instead of still being imported
    const response = await $fetch('/api/callBackend', {
      method: 'POST',
      headers: { 'x-parse-session-token': user.getSessionToken() },
      body: {
        endpoint: 'v1/import/cancelImport',
        data: { userId: user.id }
      }
    })
    // callBackend wraps the backend reply: success is only the transport flag
    if (!response?.success || !response.data?.success) {
      throw new Error(response?.data?.error || response?.error || 'Cancel failed')
    }

    showImportStatusModal.value = false
    store.showAlert({
      message: t('import_export.modal.cancelled'),
      type: 'warning'
    })

    await user.fetch().catch(() => {})
    await store.refreshImportStatus()
  } catch (error) {
    // Keep importCancelled: the backend may have cancelled before failing.
    // It's reset when a new import starts.
    console.error('Error cancelling import:', error)
    store.showAlert({
      message: t('import_export.modal.cancel_error'),
      type: 'error'
    })
  } finally {
    cancelling.value = false
  }
}

// Lifecycle hooks
onMounted(async () => {
  await store.refreshImportStatus()

  // Check URL param for showImportProgress
  const route = useRoute()
  if (route.query.showImportProgress === 'true') {
    showImportStatusModal.value = true
  }
})

onUnmounted(() => {})

// Watch for modal visibility to manage subscription
watch(showImportStatusModal, (newValue) => {
  // Optimize URL query parameter management
  const hasShowImportProgress = 'showImportProgress' in route.query
  
  if (newValue) {
    // Add showImportProgress to URL when modal opens (only if not already present)
    if (!hasShowImportProgress) {
      router.replace({ 
        query: { 
          ...route.query,
          showImportProgress: 'true' 
        }
      })
    }
  } else {
    console.log('hasShowImportProgress: ', hasShowImportProgress)
    // Remove showImportProgress from URL when modal closes (only if present)
    if (hasShowImportProgress) {
      const { showImportProgress, ...restQuery } = route.query
      router.replace({ query: restQuery })
    }
    
    // Keep subscription active even when modal is closed
    // This ensures we get updates for other parts of the app
    // Only unsubscribe on component unmount
  }
})
</script>
