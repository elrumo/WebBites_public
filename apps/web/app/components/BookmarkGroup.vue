<template>
    <div class="bookmark-group-container">
        <!-- <div class="bookmark-group-header">
            <SearchOptions/>
        </div> -->

        <!-- Teleported so no transformed/contained ancestor in the app shell
             can turn `position: fixed` into "bottom of the grid". -->
        <ClientOnly>
        <Teleport to="body">
        <Transition name="slide-up">
            <div v-if="sitesSelected.length > 0" class="options-btn-group">
                <UPopover
                    :content="{
                        positionStrategy: 'absolute',
                    }"
                    :ui="{
                        content: 'min-w-[80vw] md:min-w-[400px] rounded-lg bg-neutral-50 dark:bg-neutral-800',
                    }"
                >
                    <UButton
                        @click="deleteModal = !deleteModal"
                        color="error"
                        variant="solid"
                        class="rounded-full shadow-lg hover:-translate-y-1"
                    >
                        <IconBrew icon="Trash" />
                    </UButton>

                    <template #content>
                        <div class="text-center flex flex-col items-center p-4 border border-neutral-200 dark:border-neutral-700 rounded-md">
                            <p v-if="sitesSelected.length == 1">
                                {{ $t('bookmarks.delete_confirmation_single') }}
                            </p>
                            <p v-else>
                                {{ $t('bookmarks.delete_confirmation_multiple', { count: sitesSelected.length }) }}
                            </p>
                            <div class="flex mt-4 gap-4">
                                <UButton @click="deleteSelectedSites" color="error" size="sm">
                                    {{ $t('common.delete') }}
                                </UButton>
                            </div>
                        </div>
                    </template>
                </UPopover>

                <!-- TODO: Batch add tags -->
                <!-- TODO: Batch pin sites -->
                <UButton
                    @click="selectAllVisible"
                    variant="ghost"
                    class="bg-white/80 dark:bg-black/70 hover:-translate-y-1 border border-neutral-100 dark:border-neutral-700/70 rounded-full shadow-lg"
                >
                    {{ $t('bookmarks.select_all_visible', { count: filteredSites.length }) }}
                </UButton>

                <UButton
                    @click="sitesSelected = []"
                    variant="ghost"
                    class="bg-white/80 dark:bg-black/70 hover:-translate-y-1 border border-neutral-100 dark:border-neutral-700/70 rounded-full shadow-lg"
                >
                    {{ $t('bookmarks.unselect_all') }}
                </UButton>
                
                <UButton
                    @click="copyUrl(sitesSelected)"
                    variant="ghost"
                    class="bg-white/80 dark:bg-black/70 hover:-translate-y-1 border border-neutral-100 dark:border-neutral-700/70 rounded-full shadow-lg"
                >
                    {{ $t('bookmarks.copy_url') }}
                </UButton>

                <!-- Merge only makes sense for pictures, and only for more
                     than one of them. It trashes the absorbed bookmarks, so it
                     confirms first, like delete does. -->
                <UPopover
                    v-if="canMergeSelected"
                    :content="{ positionStrategy: 'absolute' }"
                    :ui="{ content: 'min-w-[80vw] md:min-w-[400px] rounded-lg bg-neutral-50 dark:bg-neutral-800' }"
                >
                    <UButton
                        variant="ghost"
                        :loading="merging"
                        class="bg-white/80 dark:bg-black/70 hover:-translate-y-1 border border-neutral-100 dark:border-neutral-700/70 rounded-full shadow-lg"
                    >
                        <UIcon name="i-heroicons-square-2-stack" class="w-4 h-4 mr-1" />
                        {{ $t('bookmarks.merge') }}
                    </UButton>

                    <template #content>
                        <div class="text-center flex flex-col items-center p-4 border border-neutral-200 dark:border-neutral-700 rounded-md">
                            <p>{{ $t('bookmarks.merge_confirmation', { count: sitesSelected.length }) }}</p>
                            <p class="text-xs text-neutral-500 mt-1">{{ $t('bookmarks.merge_explainer') }}</p>
                            <div class="flex mt-4 gap-4">
                                <UButton @click="mergeSelectedSites" size="sm" :loading="merging">
                                    {{ $t('bookmarks.merge') }}
                                </UButton>
                            </div>
                        </div>
                    </template>
                </UPopover>

                <AddToBoardDropdown :websiteIds="sitesSelected.map(s => s.objectId)">
                    <UButton
                        variant="ghost"
                        class="bg-white/80 dark:bg-black/70 hover:-translate-y-1 border border-neutral-100 dark:border-neutral-700/70 rounded-full shadow-lg"
                    >
                        <UIcon name="i-tabler-layout-board" class="w-4 h-4 mr-1" />
                        {{ $t('bookmark_group.add_to_board') }}
                    </UButton>
                </AddToBoardDropdown>

                <!-- Same builder as the card menu and the modal's, so the
                     wording and the rules can't drift between them. -->
                <UDropdownMenu :items="bulkHideItems">
                    <UButton
                        variant="ghost"
                        class="bg-white/80 dark:bg-black/70 hover:-translate-y-1 border border-neutral-100 dark:border-neutral-700/70 rounded-full shadow-lg"
                    >
                        <UIcon name="i-tabler-eye-off" class="w-4 h-4 mr-1" />
                        {{ $t('bookmarks.hide.label') }}
                    </UButton>
                </UDropdownMenu>
            </div>
        </Transition>
        </Teleport>
        </ClientOnly>

        <!-- <WebsiteModal
            :website="webToShow"
            :showModal="showWebsiteModal"
            @setModalView="setModalView"
        /> -->

        <div class="bookmark-group-wrapper">
            
            <div v-if="filteredSites.length > 0">
                <div
                    v-if="!isMounted || isFiltering || !useVirtualScroller"
                    :class="`bookmark-static-${userOptions.displayMode.replaceAll(' ', '-').toLowerCase()}`"
                >
                    <!-- :class="`display-${userOptions.displayMode.replaceAll(' ', '-').toLowerCase()} bookmark-static-grid`" -->
                    <div
                        class="masonry-item"
                        v-for="(site, siteIndex) in filteredSites"
                        :key="site.objectId || site.customId"
                    >
                        <BookmarkCard
                            v-if="site.objectId"
                            :viewType="userOptions.displayMode"
                            :website="site"
                            :forceShowSummary="siteIndex === 1"
                            :isCompact="cardSize === 'compact'"
                        />

                        <PreviewBookmarkCard v-else :class="{ 'aspect-[16/12]': userOptions.displayMode == 'grid' }" />
                    </div>
                </div>

                <!-- Client: virtual scroller takes over after mount (only for large collections) -->
                <DynamicScroller
                    v-if="isMounted && !isFiltering && useVirtualScroller"
                    :items="virtualRows"
                    :min-item-size="minRowHeight"
                    :buffer="1800"
                    key-field="id"
                    page-mode
                    :class="`display-${userOptions.displayMode.replaceAll(' ', '-').toLowerCase()}`"
                >
                    <template #default="{ item: row, index, active }">
                        <DynamicScrollerItem
                            :item="row"
                            :active="active"
                            :size-dependencies="[
                                row.sites.map(s => s.objectId || s.customId).join(','),
                                userOptions.displayMode,
                                userOptions.imageRatio,
                                userOptions.screenshotAsThumbnail,
                            ]"
                            :data-index="index"
                        >
                            <div class="bookmark-row">
                                <div
                                    class="masonry-item"
                                    v-for="(site, siteIndex) in row.sites"
                                    :key="site.objectId || site.customId"
                                >
                                    <BookmarkCard
                                        v-if="site.objectId"
                                        :viewType="userOptions.displayMode"
                                        :website="site"
                                        :showSummary="row.startIndex + siteIndex === 0"
                                        :isCompact="cardSize === 'compact'"
                                        :cacheImages="false"
                                    />

                                    <PreviewBookmarkCard v-else :class="{ 'aspect-[16/12]': userOptions.displayMode == 'grid' }" />
                                </div>
                            </div>
                        </DynamicScrollerItem>
                    </template>
                </DynamicScroller>
            </div>

            <!-- <div v-if="true" class="loader-wrapper"> -->
            <div v-if="loading && filteredSites.length == 0" class="masonry-grid">
                <USkeleton v-for="i in 30" :key="i" class="aspect-[16/12] w-full rounded-xl" />
            </div>

            <!-- Board-specific empty state -->
            <div v-if="activeBoard && filteredSites.length == 0 && !loading" class="empty-sites">
                <div>
                  <h5 class="mb-0">{{ $t('bookmark_group.board_empty_title') }}</h5>
                  <p>{{ $t('bookmark_group.board_empty_message') }}</p>
                </div>
                <div class="hero-logo">
                    <div v-tilt="tiltOptionsLogo">
                        <img src="@/assets/images/WebBites-Icon.png" alt=""/>
                    </div>
                </div>
            </div>

            <div v-if="!activeBoard && filteredSites.length == 0 && !loading && (searchValue.length != 0 || store.scopeOwnsView)" class="empty-sites">
                <h5>
                  {{ $t('common.no_results') }}
                </h5>
                <p>
                  {{ $t('bookmarks.try_searching') }}
                </p>

                <div class="hero-logo">
                    <div v-tilt="tiltOptionsLogo">
                        <img src="@/assets/images/WebBites-Icon.png" alt=""/>
                    </div>
                </div>
            </div>

            <div v-if="!activeBoard && filteredSites.length == 0 && !loading && searchValue.length == 0 && !store.scopeOwnsView" class="empty-sites">
                <div>
                  <h5 class="mb-0">
                    {{ $t('bookmarks.empty_state_title') }}
                  </h5>
                  <p>
                    {{ $t('bookmarks.empty_state_message') }}
                  </p>
                </div>

                <div class="desktop-only">
                    <NewBookmark/>
                </div>

                <div class="hero-logo">
                    <div v-tilt="tiltOptionsLogo">
                        <img src="@/assets/images/WebBites-Icon.png" alt=""/>
                    </div>
                </div>
            </div>

            <div 
                v-if="isLoadingMore"
                class="relative -bottom-2 w-full flex justify-center items-center animate-pulse"
            >
                <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin opacity-50" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import _ from 'lodash';
import Parse from 'parse';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { vTilt } from '~/utils/vanillaTilt'

const { t } = useI18n();
const { log } = useDevLog()
const store = useStore()

const {
    createDebounce,
    deleteItems,
    loadMoreSites,
    mergeImageBookmarks,
    showAlert,
} = store

const {
    filteredSites,
    sitesSelected,
    userOptions,
    showWebsiteModal,
    activeBoard,
    activeBoardTotalBookmarks,
    showBoardModal,
    boardToEdit,
    webToShow,
    searchValue,
    loading,
    currentPage,
    scrolledToBottom,
    websiteCount,
    typesFilter,
    selectedTags,
    mousePosition,
    deleteModal,
    allSitesLoaded,
    isLoadingMore
} = storeToRefs(store)

const debounce = ref(createDebounce())
const isInitialRender = ref(true)
const hasUserScrolled = ref(false)
const tiltOptionsLogo = ref({
    max: 10,
    speed: 400,
    glare: false,
    "mouse-event-element": "body",
})
const columnCount = ref(4)
const mobileColumnCount = ref(2)
const isMounted = ref(false)

// Keep the live DOM smaller so layout/style recalculation stays predictable,
// especially when DevTools inspector is attached.
const VIRTUAL_SCROLLER_THRESHOLD = 250
let memoizedHandleScroll = null

const isFiltering = computed(() => {
    return searchValue.value.length > 0 || selectedTags.value.length > 0 || typesFilter.value.length > 0
})

const useVirtualScroller = computed(() => {
    return filteredSites.value.length > VIRTUAL_SCROLLER_THRESHOLD
})


onMounted(() => {
    isMounted.value = true
    // Ensure scroll handler is properly initialized after component is fully mounted
    // This fixes the issue where scroll-to-load doesn't work until page refresh
    // especially when navigating from '/' to '/app'

    // Mark as if user has scrolled to enable scroll-to-load immediately
    // This is needed when navigating from '/' to '/app' where data loads but scroll handler doesn't work
    hasUserScrolled.value = true;

    // Use a longer delay to ensure the component is fully rendered and scroll events are ready
    // This is particularly important when navigating between routes where data might already be loaded
    setTimeout(() => {
        handleScroll();
    }, 500);

    // Add visibility change listener to recalculate layout when page becomes visible again
    // This fixes the issue where cards stack on top of each other when navigating back to the page
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleResize);
})

onMounted(async () => {
    // updateColumnCount(true)
    try {
        const user = Parse.User.current();
        if(!user) return;
        // TODO: Is this even needed? Why do I need mousePosition on every evnet?
        // const updateMousePosition = (() => {
        //     let lastUpdate = performance.now();
        //     let updateCount = 0;

        //     return _.throttle((e) => {
        //         const now = performance.now();
        //         updateCount++;

        //         // Log performance metrics every 100 updates
        //         if (updateCount % 100 === 0) {
        //             console.debug('Mouse Position Update Performance:', {
        //                 averageTimeBetweenUpdates: (now - lastUpdate) / 100,
        //                 totalUpdates: updateCount
        //             });
        //             lastUpdate = now;
        //         }

        //         console.log('Mouse event:', e);

        //         mousePosition.value.x = e.clientX;
        //         mousePosition.value.y = e.clientY;
        //     }, 100);
        // })();
        // document.addEventListener('mousemove', updateMousePosition);

        // Cache DOM queries and style updates
        const el = document.querySelector('.bookmark-group-container');
        if(!el) return;

        // Create style update function
        const updateStyles = (() => {
            return () => {
                if (useVirtualScroller.value) {
                    el.style.setProperty('--gutter-size', `${gutterSize.value}px`);
                }
                el.style.setProperty('--max-page-width', '900px');
            };
        })();

        updateStyles();

        // Create throttled scroll handler with performance tracking
        memoizedHandleScroll = _.throttle(() => {
                hasUserScrolled.value = true;
                handleScroll();
            }, 500);

        window.addEventListener("scroll", memoizedHandleScroll, { passive: true });
    } catch (error) {
        console.error('error in beforeMount in bookmarkGroup: ', error);
    }
});


onBeforeUnmount(async () => {
    try {
        window.removeEventListener('resize', handleResize);
        if (memoizedHandleScroll) {
            window.removeEventListener('scroll', memoizedHandleScroll);
            memoizedHandleScroll.cancel?.();
        }
        handleResize.cancel?.();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    } catch (error) {
        console.log('error in beforeUnmount in bookmarkGroup: ', error);
    } finally {
        filteredSites.value = [];
        loading.value = true;
    }
})

// Create debounced resize handler with performance tracking
const handleResize = (() => {
    const debouncedResize = _.debounce(() => {
        updateColumnCount(false);
    }, 150);

    return debouncedResize;
})();

watch(() => filteredSites.value.length, (newLength, oldLength) => {
    const isSingleItemAdded = oldLength > 0 && newLength === oldLength + 1;
    const isNotFiltering = searchValue.value.length === 0 && selectedTags.value.length === 0 && typesFilter.value.length === 0;
    const isNew = isSingleItemAdded && isNotFiltering && !isInitialRender.value;

    nextTick(() => {
        updateColumnCount(isNew);
    });

    if(isNew){
        let val = filteredSites.value;
        let placeholderItems = val.filter(item => item.isPlaceholder);
        if(placeholderItems.length > 0){
            placeholderItems.forEach((placeholderItem, index) => {
                let duplicateItems = val.filter(item => item.customId === placeholderItem.customId && !item.isPlaceholder);
                if(duplicateItems.length > 0){
                    placeholderItems.splice(index, 1);
                }
            });
            filteredSites.value = val.filter(item => !item.isPlaceholder || (item.isPlaceholder && placeholderItems.includes(item)));
        }
    }

    if (newLength > 0) {
        loading.value = false;

        if (isInitialRender.value) {
            isInitialRender.value = false;
        }

        if (oldLength === 0 && newLength > 0) {
            setTimeout(() => {
                handleScroll();
            }, 500);
        } else if (oldLength > 0 && newLength > 0 && Math.abs(newLength - oldLength) > 5) {
            setTimeout(() => {
                handleScroll();
            }, 300);
        }
    }
});

// Watch only the specific properties that affect layout
watch(() => [userOptions.value.displayMode, userOptions.value.imageRatio, userOptions.value.screenshotAsThumbnail], () => {
    nextTick(() => {
        updateColumnCount(false);
        setTimeout(() => {
            updateColumnCount(false);
        }, 500);
    });
});

// Watch search/filter changes to recalculate layout
watch(() => [searchValue.value, selectedTags.value.length, typesFilter.value.length], () => {
    nextTick(() => {
        updateColumnCount(false);
        // Additional update after a short delay to ensure DOM is fully updated
        setTimeout(() => {
            updateColumnCount(false);
        }, 100);
    });
});

watch(columnCount, (newValue) => {
    document.querySelector('.bookmark-group-container').style.setProperty('--column-count', newValue);
});

// Initialize virtual scroller layout when item count crosses the threshold
watch(useVirtualScroller, (isVirtual) => {
    if (isVirtual) {
        nextTick(() => updateColumnCount(false))
    }
});

const props = defineProps({
    groupTitle: {
        type: String,
        default: 'Starred'
    },
    groupType: {
        type: String,
        default: 'regular'
    },
    cardSize: {
        type: String,
        default: 'regualar'
    },
    userSites: {
        type: Array,
        required: false
    },
})

const editActiveBoard = () => {
    boardToEdit.value = activeBoard.value
    showBoardModal.value = true
}

const copyUrl = (site) => {
    if(site.length == 1){
        navigator.clipboard.writeText(site[0].url);
        showAlert({ message: t('bookmarks.url_copied') });
    } else {
        const urls = site.map(s => s.url).join(', ');
        navigator.clipboard.writeText(urls);
        showAlert({ message: t('bookmarks.urls_copied') || t('bookmarks.url_copied') });
    }
}

const gutterSize = computed(() => {
    if (userOptions.value.displayMode.toLowerCase() == 'list' || userOptions.value.displayMode.toLowerCase() == 'compact') {
        return 14;
    } else if (userOptions.value.displayMode.toLowerCase() == 'grid') {
        switch (columnCount.value) {
            case 2:
                return 18 - 2;
            case 3:
                return 26 - 3 + 5;
            case 4:
                return 18 - 2 + 5;
            case 5:
                return 14 - 1 + 5;
            default:
                return 16;
        }
    }
});

const columnWidth = computed(() => {
    const width = document.documentElement.clientWidth;
    let minusSize = 0;

    if (width <= 480) {
        minusSize = 1.4;
    } else if (width > 480 && width <= 768) {
        minusSize = 2.5;
    } else if (width > 768 && width <= 1024) {
        minusSize = 0;
    } else if (width > 1024 && width <= 1600) {
        minusSize = 0;
    } else {
        minusSize = 0;
    }

    let newGutterSize = (gutterSize.value / 12) * 1;

    return (100 / columnCount.value) - newGutterSize - minusSize;
});

const virtualRows = computed(() => {
    if (!useVirtualScroller.value) return []
    const rows = []
    const cols = columnCount.value
    const sites = filteredSites.value
    for (let i = 0; i < sites.length; i += cols) {
        const rowSites = sites.slice(i, i + cols)
        rows.push({
            id: `row-${Math.floor(i / cols)}`,
            sites: rowSites,
            startIndex: i,
        })
    }
    return rows
})

const minRowHeight = computed(() => {
    const mode = userOptions.value.displayMode.toLowerCase()
    if (mode === 'list' || mode === 'compact') return 60
    return 200
})

const selectAllVisible = () => {
    // Use a Set of objectIds for O(1) lookup performance
    // This avoids deep cloning and is much faster than JSON methods
    sitesSelected.value = filteredSites.value.map(site => site);
}


const updateColumnCount = (isNew = false) => {
    if (!useVirtualScroller.value) return
    const width = document.documentElement.clientWidth;
    const el = document.querySelector('.bookmark-group-container');
    if (!el) return;

    if(userOptions.value.displayMode == 'list'){
        columnCount.value = 1;
        el.style.setProperty('--column-count', columnCount.value);
        return;
    }

    if (width <= 480) {
        columnCount.value = mobileColumnCount.value;
    } else if (width > 480 && width <= 768) {
        columnCount.value = 2;
    } else if (width > 768 && width <= 1024) {
        columnCount.value = 3;
    } else if (width > 1024 && width <= 1600) {
        columnCount.value = 4;
    } else {
        columnCount.value = 5;
    }

    el.style.setProperty('--column-count', columnCount.value);
    el.style.setProperty('--gutter-size', `${gutterSize.value}px`);
};


const handleVisibilityChange = () => {
    // When the page becomes visible again, recalculate the layout
    // This fixes the issue where cards stack on top of each other when navigating back
    if (!document.hidden && filteredSites.value.length > 0) {
        // log('Page became visible, recalculating layout');
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            // Wait for images and content to fully render
            setTimeout(() => {
                updateColumnCount(false);
            }, 100);

            // Do a second pass after a longer delay to ensure everything is loaded
            setTimeout(() => {
                updateColumnCount(false);
            }, 500);

            // Final pass to catch any late-loading images
            setTimeout(() => {
                updateColumnCount(false);
            }, 1000);
        });
    }
};

const handleScroll = async () => {
    // Defensive checks to ensure we have the necessary elements
    if (!window || !document.body) return;

    const scrollPosition = window.innerHeight + window.scrollY;
    // Prefetch ~1.5 screens before the bottom so the next page is in by the time the user gets there
    const threshold = document.body.offsetHeight - window.innerHeight * 1.5;
    const isNearBottom = scrollPosition >= threshold;

    // console.log('scrollPosition: ', {
    //     "isNearBottom": isNearBottom,
    //     "!scrolledToBottom.value": !scrolledToBottom.value,
    //     "!loading.value": !loading.value,
    //     "!allSitesLoaded.value": !allSitesLoaded.value,
    //     "hasUserScrolled.value": hasUserScrolled.value,
    //     "filteredSites.value.length > 0": filteredSites.value.length > 0,
    //     "searchValue.value.length == 0": searchValue.value.length == 0,
    //     "selectedTags.value.length == 0": selectedTags.value.length == 0,
    //     "typesFilter.value.length == 0": typesFilter.value.length == 0,
    // })

    const isBoardActive = activeBoard.value !== null

    if (
        isNearBottom &&
        // !scrolledToBottom.value &&
        !loading.value &&
        !allSitesLoaded.value &&
        hasUserScrolled.value &&
        filteredSites.value.length > 0 &&
        (isBoardActive || (searchValue.value.length == 0 && selectedTags.value.length == 0))
    ) {
        scrolledToBottom.value = true;

        if (websiteCount.value > 0 && filteredSites.value.length >= websiteCount.value) {
            scrolledToBottom.value = false;
            isLoadingMore.value = false;
            allSitesLoaded.value = true;
            return;
        }

        // Page increment is handled inside loadMoreSites() in the store
        await loadMoreSites();
        scrolledToBottom.value = false;
    }
};

const setModalView = (isVisible) => {
    // webToShow.value = {}
    showWebsiteModal.value = isVisible
};

const deleteSelectedSites = () => {
    const sitesArray = sitesSelected.value.map(site => site.objectId)
    deleteItems(sitesArray)
    sitesSelected.value = []
};

const merging = ref(false)

// Merging anything but pictures has no meaning, and one bookmark is not a merge.
const canMergeSelected = computed(() =>
    sitesSelected.value.length > 1 && sitesSelected.value.every(site => site.type === 'image')
)

const { hideMenuItems } = useHideBookmarks()

// The builder returns a single parent entry with the levels underneath; the bar
// already has its own button, so the children are what the menu shows.
const bulkHideItems = computed(() => {
    const [parent] = hideMenuItems(sitesSelected.value)
    return parent ? [parent.children] : []
})

const mergeSelectedSites = async () => {
    if (merging.value) return
    merging.value = true
    try {
        // The first selected bookmark is the target: it survives, keeps its id
        // and boards, and its picture stays the cover.
        await mergeImageBookmarks(sitesSelected.value.map(site => site.objectId))
        sitesSelected.value = []
    } finally {
        merging.value = false
    }
};


</script>

<style>
@reference "../assets/css/tailwind.css";

.bookmark-static-grid {
    @apply
        grid
        grid-cols-2 
        md:grid-cols-3
        lg:grid-cols-4 
        2xl:grid-cols-6
        w-full
        gap-4
    ;

    .masonry-item {
        min-width: 0;
    }
}

.bookmark-static-list {
    @apply
        grid
        grid-cols-1 
        w-full
        gap-2.5
        max-w-5xl
        m-auto
    ;

    .masonry-item {
        min-width: 0;
    }
}

/* Override masonry-grid's CSS grid when used on the virtual scroller */
.vue-recycle-scroller.masonry-grid {
    display: block;
    width: 100%;
}

.vue-recycle-scroller__item-wrapper {
    @apply w-full overflow-visible;
}

.vue-recycle-scroller__item-view {
    width: 100% !important;
}

.bookmark-row {
    display: flex;
    gap: var(--gutter-size, 16px);
    width: 100%;
    padding-bottom: var(--gutter-size, 16px);
}

.bookmark-row .masonry-item {
    flex: 0 0 calc((100% - (var(--gutter-size, 16px) * (var(--column-count, 4) - 1))) / var(--column-count, 4));
    min-width: 0;
    max-width: calc((100% - (var(--gutter-size, 16px) * (var(--column-count, 4) - 1))) / var(--column-count, 4));
}
</style>
