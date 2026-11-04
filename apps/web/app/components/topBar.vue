<template>
    <!-- Phone: the name of what you are looking at, the way into the sidebar,
         and one "…" for everything you do to the grid. -->
    <MobileTopBar />

    <!-- The same row on both: on a laptop it is the top bar, on a phone it is
         docked to the bottom of the screen where a thumb is — search and "+"
         side by side, as in the native app. -->
    <div
        class="search-bar-container"
        :class="{ 'search-bar-container--stowed': isBarStowed }"
        :style="{ '--bottom-bar-lift': bottomBarLift + 'px' }"
        @mouseover="startLoadingTopBar"
    >
        <div class="search-wrapper relative">
            <!-- Desktop only: on a phone the sidebar opens from the mobile header,
                 where the chevron sits next to the title.

                 It lives in this row rather than floating on its own so that the
                 space to its left is the same space the settings island leaves on
                 the right — both are edges of `.search-wrapper`, whatever width
                 that box happens to be. -->
            <div
                class="hidden md:block mr-auto p-1.5 transition-all !rounded-xl"
                :class="{'top-bar-island': scrolled}"
            >
                <UButton
                    square
                    variant="ghost"
                    :icon="showSideBar ? 'i-tabler-layout-sidebar-filled' : 'i-tabler-layout-sidebar'"
                    @click="showSideBar = !showSideBar"
                />
            </div>

            <SearchBar
                class="search-bar transition-all p-1.5"
                :class="{'top-bar-island': scrolled}"
            />

            <div
                class="top-bar-actions transition-all flex-row items-center gap-1 justify-end p-1.5"
                :class="{'top-bar-island': scrolled}"
            >
                <UChip 
                    v-if="!isMobile && !isExtensionChipDismissed" 
                    size="sm"
                >
                    <UButton
                        to="https://chromewebstore.google.com/detail/webbites-browser-extensio/kphdbcjcdhecefloameedhhldchhbela"
                        target="_blank"
                        variant="ghost"
                        size="xs"
                        class="rounded-full relative group"
                    >
                        {{ t('footer.extension') }}
                        <!-- <button 
                            @click="dismissExtensionChip"
                            id="extension-chip-dismiss-button"
                            class="opacity-0 group-hover:opacity-100 absolute -top-2 -left-2 w-3.5 h-3.5 bg-gray-500 hover:bg-gray-600 text-white rounded-full flex items-center justify-center text-xs transition-all"
                            aria-label="Dismiss"
                        >
                            <UIcon name="i-heroicons-x-mark" class="w-1 h-1"/>
                        </button> -->
                    </UButton>
                </UChip>


                <UChip 
                    v-if="currentUser?.importAccessStatus == 'importing' && !isMobile" 
                    size="xl" 
                    text="" 
                    class="hover:scale-105 transition-all" 
                >
                    <UButton
                        @click="showImportStatusModal = true"
                        color="neutral"
                    >
                        {{ t('top_bar.importing') }}
                    </UButton>
                </UChip>

                <SearchOptions/>

                <!-- Only once there is something to show: a bell that can never
                     ring is clutter. Reading everything keeps it, with no badge. -->
                <NotificationsPopover v-if="notificationsTotal > 0" />

                <!-- Settings -->
                 <UTooltip :text="t('navigation.settings')">
                    <UButton
                        @click="showSettingsModal = true"
                        variant="ghost"
                        color="neutral"
                        square
                        size="sm"
                        class="rounded-full hover:shadow-md"
                    >
                        <IconBrew icon="settings" :size="20"/>
                    </UButton>
                </UTooltip>

            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { mapWritableState, mapActions } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useI18n } from 'vue-i18n';
const { t } = useI18n();


const store = useStore()
const isSelected = ref(false)
const isExtensionChipDismissed = ref(true)
const titlebar = ref(null)
/* How far the docked bar has to rise to clear whatever is covering the bottom
   of the layout viewport — the on-screen keyboard, and Safari's own toolbar,
   both of which sit over a `fixed` bar without resizing the page. The visual
   viewport is the only thing that reports that overlap. */
const bottomBarLift = ref(0)

const {
    isMobile,
    sitesSelected,
    filesToUpload,
    hasFocusTipTap,
    currentUser,
    showSettingsModal,
    showImportStatusModal,
    showWebsiteModal,
    startLoadingSettings,
    startLoadingTipTap,
    scrolled,
    showSideBar,
    rssScope,
    notificationsTotal,
} = storeToRefs(store)

/* On a phone the bar is docked over the grid, and three things take its place
   there: the selection bar, the sidebar, and the feed reader — search and "+"
   belong to the grid, not to any of them. Ignored on desktop, where the bar is
   the top bar and always in the row. */
const isBarStowed = computed(() =>
    sitesSelected.value.length > 0 || showSideBar.value || rssScope.value !== null
)

const {
    uploadFilesToParse,
    validateUrl,
    showAlert,
    saveBookmark,
    handleParseError
} = store

onMounted(() => {
    checkIfMobile()
    checkExtensionChipDismissed()
    window.addEventListener('resize', checkIfMobile)
    document.addEventListener('paste', pasteHandler)

    const viewport = window.visualViewport
    if (viewport) {
        updateBottomBarLift()
        viewport.addEventListener('resize', updateBottomBarLift)
        viewport.addEventListener('scroll', updateBottomBarLift)
    }
})

onUnmounted(() => {
    window.removeEventListener('resize', checkIfMobile)
    document.removeEventListener('paste', pasteHandler)
    document.removeEventListener("keydown", (e) => {})

    const viewport = window.visualViewport
    if (viewport) {
        viewport.removeEventListener('resize', updateBottomBarLift)
        viewport.removeEventListener('scroll', updateBottomBarLift)
    }
})

/* Everything between the bottom of what the user can see and the bottom of
   the page the bar is fixed to: the keyboard when it is up, and the browser's
   own bottom toolbar the rest of the time. Under a pixel is rounding. */
const updateBottomBarLift = () => {
    try {
        const viewport = window.visualViewport
        if (!viewport) return

        const overlap = window.innerHeight - (viewport.height + viewport.offsetTop)
        bottomBarLift.value = overlap > 1 ? Math.round(overlap) : 0
    } catch (error) {
        bottomBarLift.value = 0
    }
}

const startLoadingTopBar = () => {
    try{
        startLoadingSettings.value = true;
        startLoadingTipTap.value = true;
    } catch (error) {
        console.error('[topBar] Error in startLoadingTopBar:', error);
    }
}

const checkIfMobile = (e) => {
    try {
        isMobile.value = window.innerWidth <= 768
    } catch (error) {
        isMobile.value = false
    }
}

const checkExtensionChipDismissed = () => {
    try {
        const dismissed = localStorage.getItem('extensionChipDismissed')
        isExtensionChipDismissed.value = dismissed === 'true'
    } catch (error) {
        isExtensionChipDismissed.value = false
        console.error('[topBar] Error in checkExtensionChipDismissed:', error);
    }
}

const dismissExtensionChip = () => {
    isExtensionChipDismissed.value = true
    try {
        localStorage.setItem('extensionChipDismissed', 'true')
    } catch (error) {
        console.warn('Could not save to localStorage:', error)
    }
}

const pasteHandler = async (e) => {
    if (hasFocusTipTap.value) return

    if (e.clipboardData.files.length > 0 && !showWebsiteModal.value) {
        filesToUpload.value = e.clipboardData.files
        // Images and PDFs both; the store splits the list and refuses the rest
        // with a message naming the file, so there is nothing to check here.
        let upload = await uploadFilesToParse()
        if (!upload.error) {
            showAlert({ message: t('alerts.file_upload.success')})
            return
        } else {
            handleParseError(upload.error)
            return
        }
    }

    try {
        let paste = (e.clipboardData || window.clipboardData).getData('text')
        if (validateUrl(paste)) {
            let url = paste

            if (document.activeElement.tagName == 'INPUT' || document.activeElement.tagName == 'TEXTAREA') return

            showAlert({ message: t('alerts.bookmark.saving'), permanent: true })

            await saveBookmark({ url })
        }
    } catch (error) {
        showAlert({ message: t('alerts.bookmark.error'), type: 'danger' })
        console.log('error calling function: ', error)
    }
}
</script>


<style scoped>
@reference "../assets/css/tailwind.css";

.search-bar-container{
    @apply
        flex
        flex-row
        items-center
        z-10
        sticky
        top-0
        transition-all duration-200
        py-4
        /* backdrop-blur-xl
        bg-neutral-50/20 dark:bg-neutral-800/90
        bg-white/90 dark:bg-neutral-800/90 */
    ;
}

.top-bar-actions{
    @apply hidden md:flex;
}

/* Phone: search and "+" dock to the bottom of the screen, over the grid.
   `fixed` rather than a sticky bottom row so it stays put while the grid
   scrolls, and lifted by `--bottom-bar-lift` over anything the browser or the
   keyboard puts in front of the bottom of the page. */
@media screen and (max-width: 768px){
    .search-bar-container{
        @apply
            fixed left-0 right-0
            top-auto
            w-full
            px-4 pt-3 pb-0
            z-20
            pointer-events-none
        ;

        /* `--bottom-bar-lift` clears the keyboard and Safari's toolbar; the
           safe-area inset clears the home indicator; the rest is the air the
           bar needs to read as floating rather than stuck to the edge. */
        bottom: calc(var(--bottom-bar-lift, 0px) + env(safe-area-inset-bottom, 0px) + 1.25rem);
    }

    /* Only the controls take touches; the strip they float in does not, so a
       tap between them still reaches the card underneath. */
    .search-bar-container > .search-wrapper{
        @apply pointer-events-auto;
    }

    /* Stowed: whatever has taken the grid's place owns the bottom of the
       screen too (see `isBarStowed`). */
    .search-bar-container--stowed{
        @apply opacity-0 pointer-events-none;

        transform: translateY(140%);
    }
}
</style>
