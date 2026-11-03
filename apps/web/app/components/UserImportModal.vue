<template>
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
  <template #content>
    <div class="p-6 md:w-[620px]">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {{ $t('import_export.user_modal.title') }}
          </h3>
          <p class="text-sm text-gray-500 mt-1">
            {{ $t('import_export.user_modal.subtitle') }}
          </p>
        </div>
        <UButton
          v-if="!importing"
          variant="ghost"
          size="sm"
          icon="i-heroicons-x-mark"
          @click="closeModal"
        />
      </div>

      <!-- User Info -->
      <div v-if="user" class="well-gray mb-6">
        <div class="flex items-center">
          <div class="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mr-4 text-lg font-medium">
            {{ getUserInitials(user) }}
          </div>
          <div class="flex-1">
            <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ user.email || $t('import_export.user_modal.no_email') }}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ $t('import_export.user_modal.user_id', { id: user.objectId }) }}
            </div>
            <div class="text-xs text-gray-500">
              {{ $t('import_export.user_modal.current_bookmarks', { count: user.websiteCount || 0 }) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Import Status -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium">
            {{ $t('import_export.user_modal.import_status') }}
          </span>
          <div class="flex items-center">
            <UIcon
              :name="getImportStatusIcon()"
              class="w-4 h-4 mr-2"
              :class="getImportStatusColor()"
            />
            <span class="text-sm" :class="getImportStatusColor()">
              {{ getImportStatusText() }}
            </span>
          </div>
        </div>
        
        <!-- Import Details -->
        <div v-if="user && user.importedBookmarks" class="text-xs text-gray-500">
          <div>{{ $t('import_export.user_modal.last_import', { date: formatDate(user.updatedAt) }) }}</div>
          <div v-if="user.totalImportedBookmarks">
            {{ $t('import_export.user_modal.total_imported', { count: user.totalImportedBookmarks }) }}
          </div>
        </div>
      </div>

      <!-- Import Options -->
      <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {{ $t('import_export.user_modal.options') }}
        </label>
        
        <div class="space-y-3">
          <div class="flex items-center">
            <UCheckbox
              v-model="forceReimport"
              :disabled="importing"
              :label="$t('import_export.user_modal.force_reimport')"
            />
          </div>
          
          <div class="flex items-center">
            <UCheckbox
              v-model="skipDuplicates"
              :disabled="importing"
              :label="$t('import_export.user_modal.skip_duplicates')"
            />
          </div>
          
          <div class="flex items-center">
            <UCheckbox
              v-model="notifyUser"
              :disabled="importing"
              :label="$t('import_export.user_modal.notify_user')"
            />
          </div>
          
          <div class="flex items-center">
            <UCheckbox
              v-model="importFromParseClass"
              :disabled="importing"
              :label="$t('import_export.user_modal.from_parse_class')"
            />
          </div>
        </div>
      </div>

      <!-- Warning Message -->
      <div v-if="showWarning" class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <div class="flex">
          <UIcon name="heroicons:exclamation-triangle" class="w-5 h-5 text-yellow-400 mr-3 mt-[2px]" />
          <div>
            <h4 class="text-sm font-medium text-yellow-800">{{ $t('import_export.user_modal.notice_title') }}</h4>
            <p class="text-sm text-yellow-700 mt-1">
              {{ warningMessage }}
            </p>
          </div>
        </div>
      </div>

      <!-- Import Progress -->
      <div v-if="importing" class="mb-6">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">
            {{ $t('import_export.user_modal.progress') }}
          </span>
          <span class="text-sm text-gray-500">
            {{ importProgress }}%
          </span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div 
            class="bg-indigo-600 h-2 rounded-full transition-all duration-300"
            :style="{ width: `${importProgress}%` }"
          ></div>
        </div>
        <p class="text-xs text-gray-500 mt-2">
          {{ importStatusMessage }}
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end space-x-3">
        <UButton
          variant="ghost"
          @click="closeModal"
        >
          {{ $t('common.cancel') }}
        </UButton>
        
        <UButton
          color="primary"
          :loading="importing"
          :disabled="!user || importing"
          @click="startImport"
        >
        <!-- TODO: Update to the new importing sysetm -->
         THIS WILL NOT WORK, NEEDS UPDATING
          <UIcon v-if="!importing" name="heroicons:arrow-down-tray" class="w-4 h-4 mr-2" />
          {{ importing ? $t('import_export.user_modal.importing') : $t('import_export.user_modal.start_import') }}
        </UButton>
      </div>
    </div>
  
  </template>
</UModal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const { t, locale } = useI18n()

// Props
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  user: {
    type: Object,
    default: null
  }
})

// Emits
const emit = defineEmits(['update:modelValue', 'import-success', 'import-error'])

// Data
const importing = ref(false)
const importProgress = ref(0)
const importStatusMessage = ref('')
const forceReimport = ref(false)
const skipDuplicates = ref(true)
const notifyUser = ref(true)
const importFromParseClass = ref(false)

// Computed
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const showWarning = computed(() => {
  if (!props.user) return false
  
  return props.user.importedBookmarks && !forceReimport.value
})

const warningMessage = computed(() => {
  if (props.user?.importedBookmarks && !forceReimport.value) {
    return t('import_export.user_modal.already_imported_warning')
  }
  return ''
})

// Methods
const getUserInitials = (user) => {
  if (!user) return '??'
  
  if (user.email) {
    return user.email.substring(0, 2).toUpperCase()
  }
  return user.objectId.substring(0, 2).toUpperCase()
}

const getImportStatusIcon = () => {
  if (!props.user) return 'heroicons:question-mark-circle'
  
  if (props.user.importedBookmarks) {
    return 'heroicons:check-circle-solid'
  }
  return 'heroicons:x-circle'
}

const getImportStatusColor = () => {
  if (!props.user) return 'text-gray-400'
  
  if (props.user.importedBookmarks) {
    return 'text-green-600'
  }
  return 'text-gray-400'
}

const getImportStatusText = () => {
  if (!props.user) return t('import_export.user_modal.status_unknown')
  
  if (props.user.importedBookmarks) {
    return t('import_export.user_modal.status_imported')
  }
  return t('import_export.user_modal.status_none')
}

const formatDate = (dateString) => {
  if (!dateString) return t('import_export.user_modal.not_available')
  
  const date = new Date(dateString)
  return date.toLocaleDateString(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const startImport = async () => {
  if (!props.user || importing.value) return
  
  try {
    importing.value = true
    importProgress.value = 0
    importStatusMessage.value = t('import_export.user_modal.step_init')
    
    // Simulate progress updates
    const progressInterval = setInterval(() => {
      if (importProgress.value < 90) {
        importProgress.value += Math.random() * 10
        
        if (importProgress.value < 30) {
          importStatusMessage.value = t('import_export.user_modal.step_prepare')
        } else if (importProgress.value < 60) {
          importStatusMessage.value = t('import_export.user_modal.step_process')
        } else {
          importStatusMessage.value = t('import_export.user_modal.step_finalize')
        }
      }
    }, 500)
    
    // Call the import API
    const response = await $fetch('/api/importBookmarks', {
      method: 'POST',
      body: {
        userId: props.user.objectId,
        options: {
          forceReimport: forceReimport.value,
          importFromFile: true,
          skipDuplicates: skipDuplicates.value,
          notifyUser: notifyUser.value,
          importFromParseClass: importFromParseClass.value
        }
      }
    })
    
    clearInterval(progressInterval)
    
    if (response.success) {
      importProgress.value = 100
      importStatusMessage.value = t('import_export.user_modal.step_done')
      importing.value = false;
      
      // Wait a moment to show completion
      setTimeout(() => {
        emit('import-success', {
          user: props.user,
          response: response.data
        })
        closeModal()
      }, 1500)
    } else {
      throw new Error(response.error || t('import_export.user_modal.failed_generic'))
    }
    
  } catch (error) {
    console.error('Import error:', error)
    
    importStatusMessage.value = t('import_export.user_modal.failed', { error: error.message })
    
    emit('import-error', {
      user: props.user,
      error: error.message
    })
    
    // Reset after showing error
    setTimeout(() => {
      importing.value = false
      importProgress.value = 0
      importStatusMessage.value = ''
    }, 3000)
  }
}

const closeModal = () => {
  if (importing.value) return
  
  // Reset form state
  forceReimport.value = false
  skipDuplicates.value = true
  notifyUser.value = true
  importFromParseClass.value = false
  importProgress.value = 0
  importStatusMessage.value = ''
  
  isOpen.value = false
}

// Watch for modal close to reset state
watch(isOpen, (newValue) => {
  if (!newValue && !importing.value) {
    closeModal()
  }
})
</script>

<style scoped>
/* Custom styles for the modal */
.transition-all {
  transition: all 0.3s ease;
}

/* Progress bar animation */
.bg-indigo-600 {
  transition: width 0.3s ease;
}

/* Checkbox styling */
.space-y-3 > * + * {
  margin-top: 0.75rem;
}
</style>
