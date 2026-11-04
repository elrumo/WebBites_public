<template>
  <Transition
      name="website-modal"
      @before-enter="onBeforeModalEnter"
      @before-leave="onModalLeave"
  >
    <div
        v-if="showWebsiteModal"
        :class="'website-modal -website-details modal-type-' + type"
        size="lg"
        transition="zoom-in-center-transition"
        ref="websiteModal"
    >
        <div
            v-if="showWebsiteModal"
            class="modal-website-details-wrapper"
            :class="{ 'modal-website-details-wrapper--sidebar': showSideBarOptions }"
        >
          <!-- Mobile chrome: a drag handle over a navigation bar, laid out the
               way the native card does it — close on the left, the bite's title
               in the middle, its actions on the right. -->
          <div
              class="modal-mobile-header"
              ref="mobileDragArea"
              @touchstart="handleDragStart"
              @touchmove="handleDragMove"
              @touchend="handleDragEnd"
              @mousedown="handleDragStart"
              @mousemove="handleDragMove"
              @mouseup="handleDragEnd"
              @mouseleave="handleDragEnd"
          >
            <!-- The whole bar is the grab handle, not just the pill: that is the
                 reach a sheet is dragged by. Buttons still get their taps —
                 a drag only dismisses once it passes the threshold. -->
            <div class="mobile-drag-area">
              <div class="mobile-drag-bar"/>
            </div>

            <div v-if="isMobile" class="modal-mobile-bar">
              <UButton
                  variant="ghost"
                  color="neutral"
                  icon="i-heroicons-x-mark"
                  square
                  size="md"
                  class="modal-mobile-bar-button"
                  :aria-label="t('common.close')"
                  @click="showWebsiteModal = false"
              />

              <p class="modal-mobile-title">{{ mobileTitle }}</p>

              <div class="modal-mobile-actions">
                <UButton
                    v-if="canOpenExternally"
                    :to="webToShow.url"
                    target="_blank"
                    variant="ghost"
                    color="neutral"
                    size="md"
                    class="modal-mobile-bar-button"
                    :label="t('common.open')"
                />

                <UButton
                    variant="ghost"
                    color="neutral"
                    :icon="webToShow.pinned ? 'i-tabler-pin-filled' : 'i-tabler-pin'"
                    square
                    size="md"
                    class="modal-mobile-bar-button"
                    :aria-label="webToShow.pinned ? t('common.unpin') : t('common.pin')"
                    @click="setPin(webToShow)"
                />

                <UDropdownMenu
                    :items="actionsItems"
                    :ui="{
                      item: 'flex items-center gap-2 cursor-pointer px-4 py-2'
                    }"
                >
                    <UButton
                        variant="ghost"
                        color="neutral"
                        size="md"
                        icon="i-heroicons-ellipsis-horizontal"
                        square
                        class="modal-mobile-bar-button"
                    />
                </UDropdownMenu>
              </div>
            </div>
          </div>

          <!-- Sidebar -->
          <LazyWebsiteModalSideBar/>

          <!-- Sidebar options -->
          <LazyWebsiteModalDetails/>

          <!-- Body -->
          <div :class="{
              'modal-content-wrapper': true,
              'modal-content-wrapper-pdf': activeTab == 'pdfView' || activeTab == 'webPreview',
              'modal-content-wrapper--sidebar': showSideBarOptions,
              'p-0': (activeTab === 'siteScreenshot' && showSideBarOptions) || (activeTab === 'imageView' && showSideBarOptions)
          }">
            <div 
              class="min-h-full w-full"
              :class="webToShow?.type.includes('movie') || webToShow?.type.includes('game') ? 'h-fit' : ''"
            >
                <!-- Navigation Buttons -->
                <UFieldGroup
                  class="fixed z-20 transition-all transition-duration-200"
                  :class="{
                    'bottom-4': webToShow?.type != 'image',
                    'bottom-20': webToShow?.type == 'image'
                  }"
                  size="sm"
                  orientation="horizontal"
                  :ui="{ base: 'rounded-lg' }"
                >
                  <UButton
                    v-if="!isMobile"
                    @click="navigateSites('prev')"
                    color="neutral"
                    class=""
                    icon="i-heroicons-chevron-left"
                    :disabled="filteredSites.findIndex(site => site.objectId === webToShow.objectId) ==  0"
                  />
                  <UButton
                    v-if="!isMobile"
                    @click="navigateSites('next')"
                    color="neutral"
                    class=""
                    icon="i-heroicons-chevron-right"
                    :disabled="filteredSites.findIndex(site => site.objectId === webToShow.objectId) == filteredSites.length - 1"
                    />
                </UFieldGroup>
                
                <Transition mode="out-in" name="slide-up" appear>
                  <!-- Text Note -->
                  <TextNoteView v-if="activeTab == 'textNoteView'" :widePage="widePage" :webToShow="webToShow"/>

                  <!-- Drawing -->
                  <DrawingView v-else-if="activeTab == 'drawingView' && webToShow?.type == 'drawing'"/>

                  <!-- Saved App Store / Google Play page, laid out like the store -->
                  <AppListingView
                    v-else-if="activeTab == 'readerMode' && appListing"
                    :key="webToShow.objectId"
                  />

                  <!-- Saved social post: pictures at full size in a carousel -->
                  <SocialPostView
                    v-else-if="activeTab == 'readerMode' && socialPost"
                    :key="webToShow.objectId"
                  />

                  <!-- Reader -->
                  <ReaderView v-else-if="activeTab == 'readerMode' && webToShow?.type != 'image' && webToShow?.type != 'audio'"/>

                  <!-- Website Screenshot -->
                  <WebsiteScreenshot v-else-if="activeTab === 'siteScreenshot'" />

                  <!-- Image View-->
                  <ImageView v-else-if="activeTab === 'imageView' && webToShow?.type == 'image'"/>

                  <!-- PDF -->
                  <LazyPdfView v-else-if="activeTab === 'pdfView'"/>

                  <!-- Audio -->
                  <LazyAudioView v-else-if="activeTab === 'audioView'"/>
                </Transition>
              </div>
          </div>
        </div>

        <div v-else class="modal-empty">
        </div>

        <div
            id="modal-website-backdrop"
            ref="modalBackdrop"
            @click="showWebsiteModal = false"
        ></div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useStore } from '~/stores/myStore'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n';

import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import interact from "interactjs"

// Define emits
// const emit = defineEmits(['setModalView'])

const { log } = useDevLog()
const { t } = useI18n();
const store = useStore();

const {
  textNoteContent,
  webToShow,
  cardPosition,
  showWebsiteModal,
  isMobile,
  widePage,
  activeTab,
  showSideBarOptions,
  filteredSites,
  globalAudioInstance,
  showLinkDialog,
  lastServerTextNote,
} = storeToRefs(store)

const {
  saveUpdatedSite,
  showAlert,
  fetchSingleWebsite,
  cleanHtml,
  deleteItems,
  setPin
} = store

// Props
const props = defineProps({
  website: {}
})

// Types with no page behind them: their `url` is a placeholder, so there is
// nothing to copy or to open in a browser tab.
// `audio` included: a recording's `url` is our own copy of the file, so
// "open in a new tab" would hand the browser a download rather than a page,
// and "copy link" would copy a storage URL nobody else can use. The Audio tab
// has its own download button for the case where the file is what you want.
const typesWithoutUrl = ['textNote', 'drawing', 'game', 'movie', 'audio']

const canOpenExternally = computed(() =>
  Boolean(webToShow.value.url) && !typesWithoutUrl.includes(webToShow.value.type)
)

const socialPost = computed(() => socialPostOf(webToShow.value))
const appListing = computed(() => appListingOf(webToShow.value))

const mobileTitle = computed(() =>
  webToShow.value.siteTitle || webToShow.value.url || ''
)

const { hideMenuItems } = useHideBookmarks();

// Computed rather than a one-off ref: the modal keeps the same instance while
// you swipe between bites, so a menu frozen at setup would keep the first
// bookmark's disabled states for every one after it.
const actionsItems = computed(() => [[
    {
        label: t('website_modal.details'),
        icon: 'i-heroicons-information-circle',
        onSelect: () => {
            showSideBarOptions.value = !showSideBarOptions.value;
        }
    },
    {
        label: t('bookmarks.copy_url'),
        disabled: !canOpenExternally.value,
        icon: 'i-tabler-copy',
        onSelect: () => {
            navigator.clipboard.writeText(webToShow.value.url);
            showAlert({ message: t('bookmarks.url_copied') });
        }
    },
    ...hideMenuItems(webToShow.value)
],[
    {
        label: t('common.delete'),
        icon: 'i-tabler-trash',
        onSelect: () => {
            showWebsiteModal.value = false;
            deleteItems([webToShow.value.objectId]);
        }
    }
]]);

// Refs for component state
const audio = ref(null)
const interactPosition = ref({ x: 0, y: 0 })
const dragStartY = ref(0)
const initialY = ref(0)
const isDragging = ref(false)
const fullPageScreenshotObserver = ref(null)
const fullPageScreenshotSize = ref({ width: 0, height: 0 })
const scaleX = ref(0)
const scaleY = ref(0)
const containsTopScrollClass = ref(false)
const containsBottomScrollClass = ref(false)
const embededTweet = ref('')
const noEmbedCode = ref('')
const askedAi = ref(false)
const getEmbeddedPage = ref('')
const embedLoading = ref(false)
let transitionTime = 250

///////// Computed properties
const type = computed(() => webToShow.value.type)
const transformString = computed(() =>
  `translate3D(${interactPosition.value.x}px, ${interactPosition.value.y}px, 0)`
)

///////// Watch handlers
watch(containsBottomScrollClass, () => {
  setTimeout(() => { containsBottomScrollClass.value = false }, 700)
})

watch(containsTopScrollClass, () => {
  setTimeout(() => { containsTopScrollClass.value = false }, 700)
})

watch(() => webToShow.value, async (val, oldVal) => {
  // The two files are not interchangeable. `siteBodyFile` is the extracted
  // article — the block markup the reader is built to render. `siteHtmlFile` is
  // the raw saved page, nav bars and hydration payloads included, and putting it
  // in `siteBody` is what made the reader show whole-page junk. Keep them in
  // their own fields so the reader can tell them apart.
  const isArticleBody = Boolean(val.siteBodyFileUrl);
  let contentUrl = isArticleBody ? val.siteBodyFileUrl : val.siteHtmlFileUrl;
  // Add bookmark ID to URL if it exists
  if (val.objectId != undefined && val.objectId !=oldVal.objectId) {
    if (webToShow.value?.objectId) {

      if (globalAudioInstance.value != null) {
        try {
          globalAudioInstance.value.pause()
          webToShow.value.articleAudio.audio.pause()
        } catch (error) {
          console.error('Error stopping audio 1:', error)
        }
      }

      noEmbedCodeToShow();
      const url = new URL(window.location.href);
      url.searchParams.set('bookmarkId', webToShow.value.objectId);
      window.history.pushState({}, '', url);
      setBookmarkViewType();

      await fetchSingleWebsite(webToShow.value.objectId);

      // Update merge baseline after the full server fetch
      if (webToShow.value.type === 'textNote') {
        lastServerTextNote.value = webToShow.value.textNote || null
      }

      // Per bookmark, not per modal session: the arrows swap `webToShow`
      // without closing the modal, and skipping this fetch left the reader on
      // the truncated `siteBody` column instead of the full article file.
      if (contentUrl) {
        let html = await fetchSiteHtml(contentUrl)
        if (html) {
          if (isArticleBody) {
            webToShow.value.siteBody = html;
          } else {
            webToShow.value.siteHtml = html;
          }
        }
      }
    }
  }
}, { deep: true })

watch(showWebsiteModal, async (val) => {
  if (!val && globalAudioInstance.value != null) {
    // Stop audio if it exists
      try {
        if(globalAudioInstance.value != undefined){
          globalAudioInstance.value.pause()
          globalAudioInstance.value.src = ''
          globalAudioInstance.value = null
        }

        if(webToShow.value.articleAudio != undefined && webToShow.value.articleAudio.audio != undefined){
          webToShow.value.articleAudio.audio.pause()
          webToShow.value.articleAudio.audio.src = ''
          webToShow.value.articleAudio.audio.value = null
        }
      } catch (error) {
        console.error('Error stopping audio 2:', error)
      }
  }

  // Batch initial updates
  const updates = [
    setModalView(val),
    handleEscape(val)
  ]
  await Promise.all(updates)

  log("webToShow:", webToShow.value);

  setBookmarkViewType()

  // Toggle scroll class efficiently
  document.body.classList.toggle('no-scroll')

  // Handle modal state
  if (val) {
    await onModalOpen()
  } else {
    onModalClose()
  }
})

//////// Methods

const setModalView = (isVisible) => {
    // webToShow.value = {}
    showWebsiteModal.value = isVisible
};

const isSafari = ()=> {
  return (
    typeof window !== 'undefined' &&
    'safari' in window &&
    'pushNotification' in window.safari
  );
}

// Navigation function
const navigateSites = (direction) => {
  const currentIndex = filteredSites.value.findIndex(site => site.objectId === webToShow.value.objectId);
  const totalSites = filteredSites.value.length;

  if (totalSites <= 1) return;

  let newIndex;
  if (direction === 'next') {
    newIndex = currentIndex + 1 >= totalSites ? 0 : currentIndex + 1;
  } else {
    if (currentIndex == 0) return;
    newIndex = currentIndex - 1 < 0 ? totalSites - 1 : currentIndex - 1;
  }

  webToShow.value = filteredSites.value[newIndex];
};

const setBookmarkViewType = () => {
  // Set default values
  let activeTabValue = 'readerMode'
  let showSideBarOptionsValue = window.innerWidth >= 1600

  // Determine modal settings based on type
  const modalSettings = {
    'image': { tab: 'imageView', sidebar: false },
    'game': { sidebar: false },
    'movie': { sidebar: false },
    'dribbble': { tab: 'imageView' },
    'textNote': {
      tab: 'textNoteView',
      sidebar: false,
      additionalSetup: () => {
        textNoteContent.value = webToShow.value.textNote
        lastServerTextNote.value = webToShow.value.textNote || null
      }
    },
    'drawing': { tab: 'drawingView', sidebar: false },
    'pdf': { tab: 'pdfView' },
    'audio': { tab: 'audioView' }
  }

  // Apply settings if type exists in mapping
  if (type.value in modalSettings) {
    const settings = modalSettings[type.value]
    if (settings.tab) activeTabValue = settings.tab
    if ('sidebar' in settings) showSideBarOptionsValue = settings.sidebar
    if (settings.additionalSetup) settings.additionalSetup()

    // Early return for certain types
    if (['image', 'game', 'movie'].includes(type.value)) {
      activeTab.value = activeTabValue
      showSideBarOptions.value = showSideBarOptionsValue
      return
    }
  }

  // Apply final values
  activeTab.value = activeTabValue
  showSideBarOptions.value = showSideBarOptionsValue
}

const onModalOpen = async () => {
  audio.value = null

  // Reset position state on open
  interactPosition.value = { x: 0, y: 0 }
  isDragging.value = false
  dragStartY.value = 0
  initialY.value = 0

  // Fetch website data and process HTML in parallel if needed
  const [websiteData] = await Promise.all([
    fetchSingleWebsite(webToShow.value.objectId),
    ...(type.value === 'website' ? [
      (async () => {
        // if (webToShow.value.siteBodyFileUrl) {
        //   let html = await fetchSiteHtml(webToShow.value.siteBodyFileUrl);
        //   webToShow.value.siteBody = html;
        // }
      })()
    ] : [])
  ])

  // Update merge baseline after the full server fetch
  if (webToShow.value.type === 'textNote') {
    lastServerTextNote.value = webToShow.value.textNote || null
  }

  // Initialize drag functionality after a brief delay
  requestAnimationFrame(() => {
    startModalCardDrag()
  })
}

const onModalClose = () => {
  // Clear bookmarkId from URL if modal is closed
  const url = new URL(window.location.href);
  url.searchParams.delete('bookmarkId');
  window.history.pushState({}, '', url);

  // Unset interactions
  ['modalSidebar', 'mobileDragArea'].forEach(ref => {
    const element = document.querySelector(`#${ref}`)
    if (element) interact(element).unset()
  })

  // Reset state variables
  embedLoading.value = false
  getEmbeddedPage.value = ''
  askedAi.value = false
  audio.value = null
  fullPageScreenshotSize.value = { x: 0, y: 0, width: 0, height: 0 }
  fullPageScreenshotObserver.value = null
  webToShow.value = {}
  lastServerTextNote.value = null

  // Reset drag-related state
  interactPosition.value = { x: 0, y: 0 }
  isDragging.value = false
  dragStartY.value = 0
  initialY.value = 0

  // Reset card image styles if it exists
  try {
    const cardImage = document.getElementById('cardImage' + webToShow.value.objectId)?.children[0]
    if (cardImage) {
      const stylesToReset = ['zIndex', 'position', 'width', 'height', 'transition', 'transform']
      stylesToReset.forEach(style => cardImage.style[style] = '')
    }
  } catch (error) {
    console.error("error: ", error)
  }
}

// Touch/mouse event handlers
const handleDragStart = (e) => {
  isDragging.value = true
  dragStartY.value = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY
  initialY.value = interactPosition.value.y
}

const handleDragMove = (e) => {
  if (!isDragging.value) return

  const currentY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY
  const deltaY = currentY - dragStartY.value

  // Limit upward drag
  const newY = Math.max(initialY.value + deltaY, -50)

  // Move both the modal content and drag area
  const modalContent = document.querySelector('.modal-website-details-wrapper')
  const backdrop = document.querySelector('#modal-website-backdrop');
  // const dragArea = document.querySelector('.mobile-drag-area')

  // Move both elements together
  modalContent.style.transform = `translate3D(0px, ${newY}px, 0)`
  // dragArea.style.transform = `translate3D(0px, ${newY}px, 0)`
  const blurAmount = Math.max(10 - Math.abs(newY) * 0.015, 0) // Decrease blur as user drags
  const opacity = Math.max(0.6 - Math.abs(newY) * 0.0006, 0) // Decrease opacity as user drags
  backdrop.style.background = `rgba(0, 0, 0, ${opacity})`
  // backdrop.style.cssText = `backdrop-filter: blur(${blurAmount}px); background: rgba(0, 0, 0, ${opacity})`
  backdrop.style.transition = '0s';

  // Update position for tracking
  interactPosition.value = { x: 0, y: newY }
}

const handleDragEnd = () => {
  if (!isDragging.value) return
  isDragging.value = false

  const { y } = interactPosition.value
  const threshold = window.innerHeight * 0.3 // 30% of screen height

  // The whole header is the grab area, so every tap on a button in it lands
  // here too. Nothing moved, so there is nothing to settle back — running the
  // reset anyway would repaint the backdrop on every tap.
  if (y === 0) return

  if (y > threshold) {
    showWebsiteModal.value = false
  } else {
    resetCardPosition(document.querySelector('.modal-website-details-wrapper'))
  }
}

const handleKeyDown = (e) => {
  // Check if any input or textarea is focused
  const activeElement = document.activeElement;
  const isInputFocused = activeElement.tagName === 'INPUT' ||
                        activeElement.tagName === 'TEXTAREA' ||
                        document.querySelector('.ProseMirror-focused');

  if (!isInputFocused) {
    if (e.key === 'ArrowLeft') {
      navigateSites('prev')
    } else if (e.key === 'ArrowRight') {
      navigateSites('next')
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  // transitionTime = isSafari() ? 300 : 200
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

const handleEscape = (val) => {
  try {
    // Define the handler function once to avoid creating multiple function references
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        showWebsiteModal.value = false
      }
    }

    if (val) {
      if(showLinkDialog.value) return
      document.addEventListener('keydown', escapeHandler)
    } else {
      document.removeEventListener('keydown', escapeHandler)
    }
  } catch (error) {
    console.error("error: ", error)
  }
}

const onBeforeModalEnter = (el) => {
  try {
    // Get modal element and calculate dimensions once
    const modalEl = el.children[0]
    const backdrop = el.children[1]

    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    const isMobile = window.matchMedia("(max-width: 768px)").matches
    const modalWidth = windowWidth - 64 // 4rem
    const modalHeight = windowHeight - 64

    // Calculate position values
    const centerX = windowWidth / 2
    const centerY = windowHeight / 2
    const translateX = cardPosition.value.left - centerX + cardPosition.value.width / 2 + 8
    const translateY = cardPosition.value.top - centerY + cardPosition.value.height / 2 + 8

    // Set initial styles with GPU acceleration hints
    const transition = `transform ${transitionTime}ms, opacity ${transitionTime}ms`
    modalEl.style.transition = transition
    modalEl.style.willChange = 'transform, opacity'

    // Safari optimization: use translate3d for GPU acceleration
    if (isMobile) {
      modalEl.style.transform = 'translate3d(0, 100vh, 0)'
    } else {
      scaleX.value = cardPosition.value.width / modalWidth
      scaleY.value = cardPosition.value.height / modalHeight
      // IMPORTANT: Order matters! Translate first, then scale for proper origin
      modalEl.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale3d(${scaleX.value}, ${scaleY.value}, 1)`
    }

    // Use requestAnimationFrame for smoother animations
    requestAnimationFrame(() => {
      // Animate ONLY the background colour. Animating backdrop-filter blur is a
      // massive Safari perf hit (it re-samples + re-blurs everything behind the
      // modal every frame). Fade the colour in during the scale, then apply the
      // static blur once the animation has finished so it never animates.
      backdrop.style.cssText = 'transition: background ' + transitionTime + 'ms; background: rgba(0, 0, 0, 0.7)'

      // Reset transforms - translate first, then scale
      modalEl.style.transform = 'translate3d(0, 0, 0) scale3d(1, 1, 1)'

      // Clear transition and will-change after animation. Promoting the layer
      // for the duration of the animation only (rather than leaving will-change
      // on permanently) keeps Safari from holding a large composited layer idle.
      setTimeout(() => {
        modalEl.style.transition = ''
        modalEl.style.willChange = 'auto'
        // Blur applied AFTER the transform animation completes — no per-frame blur.
        backdrop.style.backdropFilter = 'blur(5px)'
        backdrop.style.webkitBackdropFilter = 'blur(5px)'
      }, transitionTime + 50)
    })

  } catch (error) {
    console.error("error onBeforeModalEnter: ", error)
    el.children[1].style.opacity = '1'
  }
}

const onModalLeave = (el) => {
  try {
    const modalEl = el.children[0]
    const backdrop = el.children[1]

    // Cache window dimensions
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    const isMobile = window.matchMedia("(max-width: 768px)").matches
    const transition = `transform ${transitionTime}ms ease-in, opacity ${transitionTime}ms ease-in`

    // Set transition and will-change for GPU acceleration
    modalEl.style.transition = transition
    modalEl.style.willChange = 'transform, opacity'
    modalEl.style.opacity = '0'

    // Safari optimization: use translate3d for GPU acceleration
    if (isMobile) {
      el.style.transform = 'translate3d(0, 100vh, 0)'
    } else {
      // Calculate modal dimensions
      const modalWidth = windowWidth - 64 // 4rem
      const modalHeight = windowHeight - 64

      // Calculate scale and translation
      const scaleX = cardPosition.value.width / modalWidth
      const scaleY = cardPosition.value.height / modalHeight

      const translateX = cardPosition.value.left - (windowWidth / 2) + cardPosition.value.width / 2 + 8
      const translateY = cardPosition.value.top - (windowHeight / 2) + cardPosition.value.height / 2 + 8

      // IMPORTANT: Order matters! Translate first, then scale for proper origin
      modalEl.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale3d(${scaleX}, ${scaleY}, 1)`
    }

    // Update backdrop. Drop the blur instantly (no transition on backdrop-filter)
    // and only fade the background colour out — animating the blur on leave is
    // the same Safari per-frame re-sample cost as on enter.
    backdrop.style.backdropFilter = 'none'
    backdrop.style.webkitBackdropFilter = 'none'
    backdrop.style.cssText = 'transition: background ' + transitionTime + 'ms ease-in; background: rgba(0, 0, 0, 0)'

  } catch (error) {
    console.error("error onModalLeave: ", error)
    if (el.children[0]) el.children[0].style.opacity = '0'
  }
}

const startModalCardDrag = () => {
  // Mobile drag is now handled by touch/mouse events directly
  // This function is kept for backwards compatibility
}

const interactSetPosition = (coordinates, card) => {
  try{
    const { x = 0, y = 0 } = coordinates
    interactPosition.value = { x, y }

    // Batch DOM updates
    requestAnimationFrame(() => {
      try{
        card.style.transform = transformString.value
        const backdropModal = document.querySelector('#modal-website-backdrop')
        backdropModal.style.cssText = `transition: 0s; background: rgba(0,0,0,${Math.max(0.6 - y * 0.0005, 0)})`
      } catch (e) {
        console.error("error interactSetPosition requestAnimationFrame: ", e)
      }
    })
  } catch (e) {
    console.error("error interactSetPosition: ", e)
  }
}

const resetCardPosition = (card) => {
  try{
    const backdrop = document.querySelector('#modal-website-backdrop')
    const { y } = interactPosition.value

    // Check if modal should close based on drag position
    if (y >= window.innerHeight * 0.6) {
      showWebsiteModal.value = false
      interactPosition.value = { x: 0, y: 0 }
    }

    // Reset position and apply transitions
    interactSetPosition({ x: 0, y: 0 }, card)

    // Batch style updates
    requestAnimationFrame(() => {
      card.style.cssText = 'transition: transform 0.25s, scale 0.25s'

      backdrop.style.cssText = 'transition: 0.2s; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(10px)'

      // Clear transitions after animation
      setTimeout(() => {
        card.style.cssText = ''
      }, 250)
    })
  } catch (e) {
    console.error("error resetting card position: ", e)
  }
}

// const cleanHtml = (html, url) => {
//   try {
//     // Define regex patterns once
//     const patterns = [
//       [/<(script|style)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, ''], // Remove script and style tags
//       [/(style|class)=["'].*?["']/gi, ''], // Remove style and class attributes
//       [/<(link|meta)[^>]*>/gi, ''], // Remove link and meta tags
//       [/<title\b[^<]*(?:(?!<\/title>)<[^<]*)*<\/title>/gi, ''], // Removes title tags
//       [/href=["'](?!http)(.*?)["']/gi, `href="${url}$1"`] // Fixes relative URLs
//     ]

//     // Apply all replacements in a single pass
//     return patterns.reduce((html, [pattern, replacement]) =>
//       html.replace(pattern, replacement), html)

//   } catch (error) {
//     console.error("error cleaning html: ", error)
//     return html
//   }
// }

const loadTwitter = async () => {
  const modalArticle = document.querySelector(".modal-article-wrapper")

  // Load Twitter widgets
  await twttr.widgets.load(modalArticle)

  const embededTweetEl = document.getElementById('noEmbedCode')
  if (!embededTweetEl) return

  embededTweet.value = embededTweetEl.innerHTML

  // Only parse and update if needed
  if (!webToShow.value.siteTitle || !webToShow.value.noEmbedCode) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(webToShow.value.noEmbedCode, 'text/html')
    const tweetText = doc.querySelector('p')?.innerHTML?.replace(/<a\b[^<]*(?:(?!<\/a>)<[^<]*)*<\/a>/gi, '')

    // Batch updates if both are missing
    const updates = []

    if (!webToShow.value.siteTitle && tweetText) {
      webToShow.value.siteTitle = tweetText
      updates.push(
        saveUpdatedSite(webToShow.value.objectId, 'siteTitle', tweetText)
      )
    }

    if (!webToShow.value.noEmbedCode) {
      updates.push(
        saveUpdatedSite(webToShow.value.objectId, 'noEmbedCode', embededTweetEl.innerHTML)
      )
    }

    if (updates.length) {
      await Promise.all(updates)
    }
  }
}

const fetchTweet = async () => {
  try {
    const url = webToShow.value.url
    const response = await $fetch(`http://noembed.com/embed?url=${url}`, {
      method: 'get',
      parseResponse: true // Let $fetch handle JSON parsing
    })

    // Remove script tags from HTML in one operation
    response.html = response.html.replace(/<script\b[^>]*>(.*?)<\/script>/gi, '')
    return response
  } catch (error) {
    console.error("error twitter: ", error)
    return null // Return null on error for better error handling
  }
}

const noEmbedCodeToShow = async () => {
  const defaultEmbed = ['spotify', 'youtube']

  if (defaultEmbed.includes(type.value)) {
    noEmbedCode.value = webToShow.value.noEmbedCode
    return
  }

  if (type.value !== 'tweet') {
    return
  }

  noEmbedCode.value = webToShow.value.noEmbedCode

  if (!webToShow.value.noEmbedCode) {
    const tweetCode = await fetchTweet()
    embededTweet.value = tweetCode
    noEmbedCode.value = tweetCode?.html
  }

  loadTwitter()
}

const fetchSiteHtml = async (url) => {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const text = await response.text()
    return text
    // return cleanHtml(text)
  } catch (error) {
    console.error("Failed to fetch site HTML:", error)
    return false
  }
}

const removeHtmlTags = (htmlString, stringLimit = 0) => {
  if (!htmlString) return ''

  try {
    // Chain replacements for better performance
    let cleanedString = htmlString
      .replace(/<(script|head)[^>]*>[\s\S]*?<\/\1>/gi, '') // Remove script and head tags + content
      .replace(/<\/?[^>]+(>|$)/g, '') // Remove remaining HTML tags
      .replace(/\\n|\s\s+/g, ' ') // Remove newlines and extra spaces in one pass
      .replace(/&nbsp/g, '') // Use replace instead of replaceAll

    return stringLimit ? cleanedString.substring(0, stringLimit) : cleanedString
  } catch (error) {
    console.error('Error removing html:', error)
    return htmlString
  }
}
</script>

