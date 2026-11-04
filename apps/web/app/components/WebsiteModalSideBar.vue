<template>
    <div v-if="!isMobile || showTabs" class="modal-sidebar" ref="modalSidebar">
      <div class="modal-sidebar-inner">
        <!-- Top: close + options -->
        <div v-if="!isMobile" class="modal-sidebar-top">
            <UButton
                icon="i-heroicons-x-mark"
                variant="ghost"
                color="neutral"
                square
                class="rounded-full"
                @click="showWebsiteModal = false"
            />

            <BookmarkOptionsDropdown :website="webToShow" />
        </div>

        <!-- Middle: view tabs. An icon rail on desktop; on mobile a segmented
             control, the same control the native card uses, shown only when
             there is more than one view to pick between. -->
        <div v-if="showTabs" class="modal-sidebar-tabs">
            <template v-if="isMobile">
                <button
                    v-for="tab in tabItemsToShow"
                    :key="tab.key"
                    type="button"
                    class="modal-sidebar-segment"
                    :class="{ 'modal-sidebar-segment--active': activeTab === tab.key }"
                    :aria-pressed="activeTab === tab.key"
                    @click="activeTab = tab.key"
                >
                    <UIcon :name="tab.icon" class="w-4 h-4 shrink-0" />
                    <span class="modal-sidebar-segment-label">{{ tab.label }}</span>
                </button>
            </template>

            <template v-else>
                <UTooltip
                    v-for="tab in tabItemsToShow"
                    :key="tab.key"
                    :text="tab.label"
                    :content="{ side: 'right' }"
                    :ui="{ content: 'bg-primary-500 text-white font-bold rounded-lg' }"
                >
                    <button
                        type="button"
                        class="modal-sidebar-tab"
                        :class="{ 'modal-sidebar-tab--active': activeTab === tab.key }"
                        @click="activeTab = tab.key"
                    >
                        <UIcon :name="tab.icon" class="w-5 h-5" />
                    </button>
                </UTooltip>
            </template>
        </div>

        <!-- Bottom: details toggle. Mobile reaches the details panel from the
             modal's own navigation bar, as the native card does, so this stays
             on the desktop rail. -->
        <div v-if="!isMobile" class="modal-sidebar-bottom">
            <UTooltip
                :text="$t('website_modal.details')"
                :content="{ side: 'right' }"
                :ui="{ content: 'bg-primary-500 text-white font-bold rounded-lg' }"
            >
                <UButton
                    @click="showSideBarOptions = !showSideBarOptions"
                    :variant="showSideBarOptions ? 'solid' : 'ghost'"
                    size="md"
                    :color="getDetailsBtnColor"
                    class="shadow-md rounded-xl"
                    square
                    icon="i-heroicons-information-circle"
                />
            </UTooltip>
        </div>
      </div>
    </div>
  </template>

  <script setup>
    import { storeToRefs } from 'pinia'
    import { useStore } from '~/stores/myStore'
    import { useI18n } from 'vue-i18n';
    const { t } = useI18n();

    const store = useStore()
    const {
        showWebsiteModal,
        isMobile,
        activeTab,
        webToShow,
        showSideBarOptions
    } = storeToRefs(store)
    const { isDark } = store

    const getDetailsBtnColor = computed(() => {
        if(showSideBarOptions.value){
            return 'primary'
        }

        return 'neutral'
    })

    const tabItemsToShow = computed(() => {
        return tabItems.value.filter(item => {

            if (item.key === 'readerMode') {
                // A drawing has no article behind it — its url is a placeholder,
                // and neither has a recording: its transcript lives in the
                // Audio tab, beside the player that gives it its timestamps.
                return webToShow.value.type !== 'image'
                    && webToShow.value.type !== 'textNote'
                    && webToShow.value.type !== 'drawing'
                    && webToShow.value.type !== 'pdf'
                    && webToShow.value.type !== 'audio'
            } else if (item.key === 'textNoteView') {
                return webToShow.value.type === 'textNote'
            } else if (item.key === 'drawingView') {
                return webToShow.value.type === 'drawing'
            } else if (item.key === 'imageView') {
                return webToShow.value.type === 'image' || webToShow.value.type === 'dribbble'
            } else if (item.key === 'figmaView') {
                return webToShow.value.type === 'figma-file'
            } else if (item.key === 'siteScreenshot') {
                // The full-page capture, not the cropped card thumbnail. Either
                // shape the server hands back counts: older rows carry the Parse
                // file, newer ones also carry a plain URL alongside it.
                const hasFullPageScreenshot = Boolean(
                    webToShow.value.fullPageScreenshot || webToShow.value.fullPageScreenshotUrl
                )
                return hasFullPageScreenshot && webToShow.value.type != 'music'
            } else if (item.key === 'pdfView') {
                return webToShow.value.type === 'pdf' || Boolean(webToShow.value.pdf)
            } else if (item.key === 'audioView') {
                return webToShow.value.type === 'audio'
            }
            return true
        })
    })

    // Mobile shows the picker only when there is a choice to make — one lone
    // segment is a label, not a control. The desktop rail always renders: it
    // also carries the close button and the details toggle.
    const showTabs = computed(() => !isMobile.value || tabItemsToShow.value.length > 1)

    const tabItems = computed(() => [
        {
            key: 'readerMode',
            icon: 'i-heroicons-newspaper',
            label: t('website_modal.sidebar.tabs.reader')
        },
        {
            key: 'textNoteView',
            icon: 'i-heroicons-pencil',
            label: t('website_modal.sidebar.tabs.text_note')
        },
        {
            key: 'drawingView',
            icon: 'i-heroicons-paint-brush',
            label: t('website_modal.sidebar.tabs.drawing')
        },
        {
            key: 'imageView',
            icon: 'i-heroicons-photo',
            label: t('website_modal.sidebar.tabs.image')
        },
        {
            key: 'figmaView',
            icon: 'i-simple-icons-figma',
            label: t('website_modal.sidebar.tabs.figma')
        },
        {
            key: 'siteScreenshot',
            icon: 'i-heroicons-window',
            label: t('website_modal.sidebar.tabs.screenshot')
        },
        {
            key: 'pdfView',
            icon: 'i-heroicons-document',
            label: t('website_modal.sidebar.tabs.pdf')
        },
        {
            key: 'audioView',
            icon: 'i-heroicons-microphone',
            label: t('website_modal.sidebar.tabs.audio')
        }
    ])
  </script>
