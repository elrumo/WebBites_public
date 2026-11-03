<template>
    <LazyDragArea v-if="dragImageModal"/>
    <LazyShortcutsModal v-if="shortcutsModalOpened"/>
    <LazyUpgradeModal v-if="upgradeModalOpened"/>
    <LazyImportStatusModal v-if="importStatusModalOpened"/>
    <LazySubscriptionSuccessModal v-if="subscriptionSuccessOpened"/>
    <LazyCommunicationModal v-if="parseConfig?.showMessageModal"/>
    <LazyImportBookmarksModal v-if="importBookmarksModalOpened"/>
    <LazySettingsModal v-if="settingsModalOpened || startLoadingSettings"/>
    <LazyBoardModal v-if="boardModalOpened" />
    <LazyShareBoardModal v-if="shareBoardModalOpened" />
    <LazyFolderModal v-if="folderModalOpened" />
    <LazyAddFeedModal v-if="addFeedModalOpened" />
    <LazyFeedSettingsModal v-if="feedSettingsModalOpened" />
    <LazyTrashModal v-if="trashModalOpened" />
    <LazyTagManagerModal v-if="tagManagerModalOpened" />
    <LazyPrivateUnlockModal v-if="privateUnlockModalOpened" />
    <LazyOnboardingWizard/>
    <LazyQuestionnaireModal/>
    <LazyNewBookmark :isQuickSave="true"/>
    <LazyWebsiteModal/>

    <UModal
      v-model:open="showCommandBar"
      class="command-modal"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
  <template #content>
        <LazySearchBar :isCommandBar="true"/>
    
  </template>
</UModal>

</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { defineAsyncComponent } from 'vue'

const store = useStore()

// Store state
const {
  dragImageModal,
  parseConfig,
  showCommandBar,
  startLoadingSettings,
  shortcutsModal,
  showUpgradeModal,
  showImportStatusModal,
  showImportBookmarksModal,
  showSettingsModal,
  showBoardModal,
  showShareBoardModal,
  showFolderModal,
  showAddFeedModal,
  showFeedSettingsModal,
  showTrashModal,
  showTagManagerModal,
  showPrivateUnlockModal,
} = storeToRefs(store)

// Lazy load modals for better initial page load performance
const LazyImportBookmarksModal = defineAsyncComponent(() => import('~/components/ImportBookmarksModal.vue'))
const LazyShortcutsModal = defineAsyncComponent(() => import('~/components/ShortcutsModal.vue'))
const LazyUpgradeModal = defineAsyncComponent(() => import('~/components/UpgradeModal.vue'))
const LazyImportStatusModal = defineAsyncComponent(() => import('~/components/ImportStatusModal.vue'))
const LazySubscriptionSuccessModal = defineAsyncComponent(() => import('~/components/SubscriptionSuccessModal.vue'))
const LazyCommunicationModal = defineAsyncComponent(() => import('~/components/CommunicationModal.vue'))
const LazySettingsModal = defineAsyncComponent(() => import('~/components/SettingsModal.vue'))
const LazyDragArea = defineAsyncComponent(() => import('~/components/DragArea.vue'))
const LazyBoardModal = defineAsyncComponent(() => import('~/components/BoardModal.vue'))
const LazyFolderModal = defineAsyncComponent(() => import('~/components/FolderModal.vue'))
const LazyShareBoardModal = defineAsyncComponent(() => import('~/components/ShareBoardModal.vue'))
const LazyWebsiteModal = defineAsyncComponent(() => import('~/components/WebsiteModal.vue'))
const LazyAddFeedModal = defineAsyncComponent(() => import('~/components/AddFeedModal.vue'))
const LazyFeedSettingsModal = defineAsyncComponent(() => import('~/components/FeedSettingsModal.vue'))
const LazyTrashModal = defineAsyncComponent(() => import('~/components/TrashModal.vue'))
const LazyTagManagerModal = defineAsyncComponent(() => import('~/components/TagManagerModal.vue'))
const LazyPrivateUnlockModal = defineAsyncComponent(() => import('~/components/PrivateUnlockModal.vue'))


// Track if modals have ever been opened (for lazy loading - once opened, stay loaded)
const shortcutsModalOpened = ref(false)
const upgradeModalOpened = ref(false)
const importStatusModalOpened = ref(false)
const subscriptionSuccessOpened = ref(false)
const importBookmarksModalOpened = ref(false)
const settingsModalOpened = ref(false)
const boardModalOpened = ref(false)
const shareBoardModalOpened = ref(false)
const folderModalOpened = ref(false)
const addFeedModalOpened = ref(false)
const feedSettingsModalOpened = ref(false)
const trashModalOpened = ref(false)
const tagManagerModalOpened = ref(false)
const privateUnlockModalOpened = ref(false)


// Watch store state to mark modals as opened
watch(shortcutsModal, (val) => { if (val) shortcutsModalOpened.value = true })
watch(showUpgradeModal, (val) => { if (val) upgradeModalOpened.value = true })
watch(showImportStatusModal, (val) => { if (val) importStatusModalOpened.value = true })
watch(showImportBookmarksModal, (val) => { if (val) importBookmarksModalOpened.value = true })
watch(showSettingsModal, (val) => { if (val) settingsModalOpened.value = true })
watch(showBoardModal, (val) => { if (val) boardModalOpened.value = true })
watch(showFolderModal, (val) => { if (val) folderModalOpened.value = true })
watch(showShareBoardModal, (val) => { if (val) shareBoardModalOpened.value = true })
watch(showAddFeedModal, (val) => { if (val) addFeedModalOpened.value = true })
watch(showFeedSettingsModal, (val) => { if (val) feedSettingsModalOpened.value = true })
watch(showTrashModal, (val) => { if (val) trashModalOpened.value = true })
watch(showTagManagerModal, (val) => { if (val) tagManagerModalOpened.value = true })
watch(showPrivateUnlockModal, (val) => { if (val) privateUnlockModalOpened.value = true })

// Back from an OAuth round trip. The modals that read these params are lazy
// and would not mount until something else opened them, so open them here.
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  if (params.has('importConnect')) showImportBookmarksModal.value = true
  if (params.has('backupConnect')) showSettingsModal.value = true
})

</script>
