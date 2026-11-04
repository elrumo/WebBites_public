<template>
    <div
        ref="cardRootRef"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
        @touchstart="handleTouchStart"
        @touchend="handleTouchEnd"
        @touchmove="handleTouchEnd"
        @contextmenu="onContextMenu"
        class="flex w-full group"
    >
        <CardReactions
            v-if="!readonly"
            :website="website"
            :checked="checked"
            :show-card-options="showCardOptions"
            :is-pinned="isPinned"
            v-model:checked="checked"
        />

        <!-- <UCard -->
        <div
            v-if="website.objectId"
            :ref="'bookmarkCard-' + website.objectId"
            :id="'bookmarkCard-' + website.objectId + (isPinned ? '-pinned' : '')"
            class="bookmark-card-base"
            :class="{
                'grid-item': isGridView,
                'group/grid': isGridView && hoverEnabled,
                'no-preview-tags': !showPreviewTags,
                'website': type == 'website',
                'list-item group/list': userOptions.displayMode == 'list',
                'compact-item group/compact': userOptions.displayMode == 'compact',
                'bookmark-card-checked': checked,
                'mobile': isMobile,
                'compact': isCompact,
                'twitter': isTweet,
                'image': type == 'image' || type == 'dribbble' || type == 'unsplash' || isSocialMedia,
                'social-media': isSocialMedia,
                'youtube': type == 'youtube',
                'spotify': type == 'music' || isMusic,
                'text-note': type == 'textNote',
                'drawing': type == 'drawing',
                'pdf': type == 'pdf',
                'audio': type == 'audio',
                'app': isApp,
                'stack': imageCount > 1 && isGridView,
                'media': type == 'movie' || type == 'game',
                'movie': type == 'movie',
                'game': type == 'game',
                'is-pinned': isPinned,
                'readonly': readonly,
                'shopping': isShopping,
            }"
            :draggable="!readonly"
            @dragstart="!readonly && dragStart(website)"
            @dragend="dragEnd()"
            @click="handleCardClick($event)"
            @click.right="showMenu = true"
        >
            <Transition name="curtain-down">
                <div
                    v-if="website.aiSummary && (showSummary) && userOptions.summaryCardOnHover && !isMusic"
                    ref="summaryCardRef"
                    class="summary-mouse-follow"
                    :style="{
                        transform: summaryTransform
                    }"
                >
                    <CardSummary
                        :compact="true"
                        :summary="website.aiSummary"
                        :website="website"
                        :showImage="false"
                    />
                </div>
            </Transition>

            <!-- Header -->
            <div class="card-header">
              <div
                :class="{
                  'aspect-[4/3]': userOptions.imageRatio == '4-3' && type != 'image' && !isSocialMedia && !isPinned && isGridView && !isAppCard,
                  'aspect-[16/9]': userOptions.imageRatio == '16-9' && type != 'image' && !isSocialMedia && !isPinned && isGridView && !isAppCard,
                  'relative h-full w-full': true
                }"
              >

              <!-- Media cards keep the artwork clean until their details are needed. -->
            <div v-if="type == 'game' || type == 'movie'" class="games-bookmark-card-overview">
                <img
                    v-if="(type == 'image' || type == 'game' || type == 'movie') && setPageImage != undefined"
                    :src="cachedPageImage"
                    class="game-movie-thumbnail"
                >

                <div class="games-bookmark-card">
                    <div class="games-bookmark-card-content">
                        <div class="title">
                            {{ website.mediaTypeObject.name || website.mediaTypeObject.title }}
                        </div>
                        <p v-if="getMediaSummary" class="overview">
                            {{ getMediaSummary }}
                        </p>
                    </div>
                </div>

                <div class="media-type-tab" :aria-label="type == 'movie' ? $t('bookmarks.types.movie') : $t('bookmarks.types.game')">
                    <IconBrew :icon="type == 'movie' ? 'movie' : 'games'" class="scale-90" />
                </div>
            </div>

                <!-- Image and tags -->
                <div
                    @mouseover="onMouseOverCard()"
                    @mouseleave="onMouseLeaveCard()"
                    :id="'cardImage' + website.objectId"
                    class="h-full card-image-stage"
                >
                    <!-- The fan behind the cover of a multi-image bookmark. The
                         pictures are the real next two; a card that predates
                         them in the search index gets blank ones. -->
                    <template v-if="imageCount > 1 && isGridView">
                        <div class="stack-back stack-back-1" aria-hidden="true">
                            <img v-if="stackImages[0]" :src="stackImages[0]" alt="" loading="lazy" decoding="async">
                        </div>
                        <div class="stack-back stack-back-2" aria-hidden="true">
                            <img v-if="stackImages[1]" :src="stackImages[1]" alt="" loading="lazy" decoding="async">
                        </div>
                    </template>

                    <div v-if="isTweet" class="x-logo"> 𝕏 </div>

                    <!-- A multi-image bookmark shows how many pictures it holds.
                         No carousel here: the grid is virtualised masonry and a
                         horizontal swipe would fight the scroll container. -->
                    <div v-if="imageCount > 1" class="card-image-count" :aria-label="$t('bookmarks.image_count', { n: imageCount })">
                        <UIcon name="i-heroicons-square-2-stack" />
                        <span>{{ imageCount }}</span>
                    </div>

                    <!-- A social post with pictures is drawn like an image bookmark:
                         the picture alone, and what the post says only on hover. -->
                    <div v-if="isSocialMedia" class="social-hover">
                        <div class="social-hover-head">
                            <img v-if="website.siteLogo" :src="website.siteLogo" alt="" class="social-hover-logo">
                            <span class="social-hover-author">{{ socialInfo.author }}</span>
                        </div>
                        <p v-if="socialInfo.text" class="social-hover-text">{{ socialInfo.text }}</p>
                    </div>

                    <!-- Which platform it came from, always visible. -->
                    <div
                        v-if="isSocialMedia && socialBrand"
                        class="card-social-badge"
                        :style="socialBrand.color ? { color: socialBrand.color } : undefined"
                        :title="socialPlatform"
                    >
                        <UIcon :name="socialBrand.icon" class="size-3.5" />
                    </div>

                    <!-- The cover of a PDF is a rendered page, which on its own
                         is indistinguishable from a screenshot of a web page.
                         The badge is what says this card is a document, and how
                         long a one. -->
                    <div v-if="type == 'pdf'" class="card-image-count card-pdf-badge">
                        <UIcon name="i-heroicons-document-text" />
                        <span>{{ pdfBadgeLabel }}</span>
                    </div>
                    
                    <!-- A recording has no picture of its own, and the image
                         chain would end on a random gradient — which dresses a
                         voice note up as a photo bookmark. The waveform is what
                         says "this is audio" at a glance, and it is the
                         recording's own shape where the client sent one. -->
                    <!-- An app, laid out like the store's own card: icon, name, tagline,
                         stars and a View button over a row of screenshots. -->
                    <div v-if="isAppCard" class="card-app">
                        <div class="card-app-top">
                            <img
                                v-if="website.siteLogo"
                                :src="website.siteLogo"
                                alt=""
                                class="card-app-icon"
                                loading="lazy"
                                decoding="async"
                                draggable="false"
                                referrerpolicy="no-referrer"
                            >
                            <div class="card-app-text">
                                <h4 class="card-app-title">{{ website.siteTitle }}</h4>
                                <p v-if="appTagline" class="card-app-tagline">{{ appTagline }}</p>
                                <p v-if="appRating != null" class="card-app-rating" :aria-label="$t('website_modal.app.ratings', { count: appRatingCount })">
                                    <span class="card-app-stars" aria-hidden="true">
                                        <span class="card-app-stars-fill" :style="{ width: `${appRating / 5 * 100}%` }">★★★★★</span>★★★★★
                                    </span>
                                    <span v-if="appRatingCount">{{ appRatingCount }}</span>
                                </p>
                            </div>
                            <a
                                :href="website.url"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="card-app-view"
                                @click.stop
                            >{{ $t('website_modal.app.view') }}</a>
                        </div>

                        <div
                            v-if="appShots.length"
                            class="card-app-shots"
                            :style="{ gridTemplateColumns: `repeat(${appShots.length}, minmax(0, 1fr))` }"
                        >
                            <img
                                v-for="shot in appShots"
                                :key="shot"
                                :src="shot"
                                alt=""
                                class="card-app-shot"
                                loading="lazy"
                                decoding="async"
                                draggable="false"
                                referrerpolicy="no-referrer"
                            >
                        </div>
                    </div>

                    <div v-if="isAudio" class="card-audio">
                        <div class="card-audio-wave" aria-hidden="true">
                            <span
                                v-for="(bar, index) in audioBars"
                                :key="index"
                                class="card-audio-bar"
                                :style="{ height: `${Math.max(6, bar * 100)}%` }"
                            ></span>
                        </div>

                        <div class="card-audio-meta">
                            <UIcon :name="audioIsVoiceNote ? 'i-heroicons-microphone' : 'i-heroicons-musical-note'" />
                            <span v-if="audioLength">{{ audioLength }}</span>
                        </div>

                        <p v-if="audioTranscribing" class="card-audio-status">
                            <UIcon name="i-heroicons-arrow-path" class="animate-spin" />
                            <span>{{ $t('website_modal.audio.transcribing') }}</span>
                        </p>
                        <p v-else-if="audioExcerpt" class="card-audio-excerpt">{{ audioExcerpt }}</p>
                    </div>

                    <img
                      v-if="website.url?.endsWith('.avif') && !isTweet && !isCompact"
                      :src="website.url"
                      @load="onImageLoad($event)"
                      :alt="$t('bookmark_card.image_alt')"
                      class="card-image"
                      placeholder
                      decoding="async"
                    >

                    <!-- Standard card && image card-->
                    <!-- DEFAULT MAIN IMAGE CARD -->
                    <!-- <NuxtImg -->
                    <img
                      v-if="
                        !isMusic &&
                        !isTweet  &&
                        !isAudio &&
                        !isApp &&
                        (!isCompact || isPinned || isGridView || type == 'image' || type == 'game') &&
                        type != 'textNote' &&
                        !isDrawingWithoutPreview &&
                        setPageImage != undefined &&
                        !website.url?.endsWith('.avif')
                      "
                      :src="cachedPageImage"
                      @error="onImageError($event)"
                      @load="onImageLoad($event)"
                      :alt="$t('bookmark_card.image_alt')"
                      class="card-image"
                      :loading="imgLoading"
                      draggable="false"
                      format="webp"
                      quality="50"
                      placeholder
                      decoding="async"
                    />

                    <img
                      v-if="
                        !isMusic &&
                        !isTweet  &&
                        !isAudio &&
                        !isApp &&
                        (!isCompact || isPinned || isGridView || type == 'image' || type == 'game') &&
                        type != 'textNote' &&
                        setPageImage != undefined &&
                        website.url?.endsWith('.avif')
                      "
                      :src="cachedPageImage"
                      @error="onImageError($event)"
                      @load="onImageLoad($event)"
                      :alt="$t('bookmark_card.image_alt')"
                      class="card-image"
                      :loading="imgLoading"
                      placeholder
                      decoding="async"
                    />

                    <!-- A drawing with no PNG export yet, or one that failed to
                         load. The image chain ends on a random gradient, which
                         would dress the drawing up as a photo bookmark; the mat
                         and the brush read as "a board with nothing on it". -->
                    <div v-if="isDrawingWithoutPreview" class="card-drawing-placeholder">
                        <IconBrew icon="brush" :size="32" />
                    </div>

                    <div v-if="!isMusic && !isTweet && type != 'textNote'"></div>

                    <div v-else-if="isTweet" class="tweet-card" v-html="getTweet()"></div>

                    <div v-else-if="type == 'textNote'" class="h-full">
                        <div class="card-text-note">
                            <!-- A div, not a p: the note body is Tiptap block
                                 markup, and nesting it in a <p> makes the SSR
                                 parser hoist it out into the row-flex parent
                                 (word-wide columns) and hydration then blank it. -->
                            <div class="card-text-note-preview" v-html="sanitizedTextNote">
                            </div>
                        </div>
                    </div>

                    <div v-else-if="isMusic" class="spotify-card-header">
                        <div class="card-image-wrapper">
                            <img
                                :src="setMusicImage"
                                @error="$event.target.src = randomGradient(getGradientSeed('music'))"
                                :alt="$t('bookmark_card.image_alt')"
                                loading="lazy"
                                class="card-image"
                                format="webp"
                                quality="30"
                                placeholder
                            />
                            <div class="cd-container"></div>
                        </div>
                        
                        <!-- src="/images/spotify-logo-white.png" -->
                        <img
                            class="spotify-logo"
                            src="/images/SpotifyLogo.jpg"
                            @click="goTo(website.url)"
                            format="webp"
                            quality="30"
                            placeholder
                        />
                    </div>

                    <!-- Tags -->
                    <div
                        v-if="showPreviewTags"
                        class="tags-wrapper-card pointer-events-none"
                        @click="handleCardClick($event)"
                    >
                        <div
                            v-if="!isMusic"
                            v-for="(tag, index) in website.tags"
                            :style="`display:${index < 3 ? 'flex' : 'none'}`"
                        >

                            <UBadge
                                :key="tag + website.objectId + index"
                                class="shadow-sm rounded-md"
                                size="xs"
                                variant="blur"
                                v-if="index < 3"
                            >
                                {{ tag ? index < 2 ? tag.replace(/_/g, ' ') : '+' + (website.tags.length - 2) : '' }}
                            </UBadge>
                        </div>
                    </div>
                </div>
              </div>
            </div>

            <!-- Footer top part-->
            <div
                v-if="type != 'image' && type != 'dribble' && type != 'tweet' && type != 'textNote' && type != 'drawing' && type != 'game' && type != 'movie' && !isSocialMedia && !isAppCard"
                class="card-body-wrapper"
            >
                <div class="card-body-content">
                    <div v-if="!isTweet" class="w-full">
                      <div class="favicon-list">
                        <img
                          v-if="website.siteLogo"
                          :src="website.siteLogo"
                          :alt="$t('bookmark_card.favicon_alt')"
                          @error="onFaviconError($event)"
                          class="favicon"
                        />
                        <img
                          v-else
                          :src="randomGradient(getGradientSeed())"
                          :alt="$t('bookmark_card.favicon_replacement_alt')"
                          class="favicon w-3 h-3"
                        >
                      </div>

                      <h4 class="card-title" v-if="website.siteTitle && type != 'game'">
                        {{ website.siteTitle }}
                      </h4>

                      <p
                          class="card-description"
                          v-if="type == 'movie' && getMediaSummary.length > 0"
                      >
                          {{ getMediaSummary }}
                      </p>

                      <Transition name="slide-up" >
                          <p
                              v-if="website.siteDescription && (userOptions.showDescription || readonly)"
                              class="card-description"
                          >
                              {{ website.siteDescription }}
                          </p>
                      </Transition>
                    </div>

                    <div
                        :class="{
                            'footer-bookmark-card': true,
                            'list-only': type == 'image' || type == 'dribble',
                        }"
                    >
                        <div
                            class="link-card-wrpapper"
                            v-if="type != 'image' && type != 'dribble' && type != 'tweet' && type != 'textNote' && !isMusic"
                        >
                            <img
                                v-if="website.siteLogo"
                                :src="website.siteLogo"
                                :alt="$t('bookmark_card.favicon_alt')"
                                @error="onFaviconError($event)"
                                class="bookmark-favicon"
                            />
                            <IconBrew v-else icon="link" class="bookmark-favicon"/>

                            <a class="card-link" target="_blank" :href="website.url">
                                {{ getUrl(website.url) }}
                            </a>
                        </div>

                        <div v-if="isMusic"></div>
                        
                        <ClientOnly>
                          <span class="text-xs opacity-70">
                              {{ getDate(website.createdAt) }}
                          </span>
                        </ClientOnly>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { useElementBounding, useMouse, useWindowSize } from '@vueuse/core';
import { useImageCache } from '~/composables/useImageCache';
import { bookmarkCoverUrl, bookmarkImageCount, bookmarkImageSources } from '~/composables/useBookmarkImages';
import { isAvatarURL, socialPlatformFromUrl, SOCIAL_BRANDS } from '~/composables/useSocialPost';
import {
    audioDurationLabel,
    audioPeaks,
    isTranscribing,
    isVoiceNote,
    transcriptText
} from '~/composables/useBookmarkAudio';
const { t, locale } = useI18n();
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';

const store = useStore();
const {
    sitesSelected,
    userOptions,
    showWebsiteModal,
    webToShow,
    draggedWebsite,
    isGridView,
    cardPosition,
    isMobile
} = storeToRefs(store);

const {
    deleteItems,
    getUrl,
    randomGradient,
    showAlert,
} = store;

// Props
const props = defineProps({
    displayMode: {
        type: String,
        default: 'grid'
    },
    isCompact: {
        type: Boolean,
        default: false
    },
    isPinned: {
        type: Boolean,
        default: false
    },
    website: {
        type: Object,
        default: () => ({})
    },
    forceShowSummary: {
        type: Boolean,
        default: false
    },
    cacheImages: {
        type: Boolean,
        default: false
    },
    // A card on a public shared board: no selection, pin, menu or drag (all of
    // them need the owner's session), and a click just opens the page.
    readonly: {
        type: Boolean,
        default: false
    }
});

const { markLoaded, isLoaded, preload, getCachedSrc } = useImageCache();

// Data
const showModal = ref(false);
const showMenu = ref(false);
// Index into imageSources; bumped on every <img> error until the gradient.
const srcIndex = ref(0);
watch(() => props.website?.objectId, () => { srcIndex.value = 0; });
const showSummary = ref(false);
const mouseOverTimer = ref(null);
const onHover = ref(false);
const showCardOptions = ref(false);
const timer = ref(null);
const summaryCardRef = ref(null);

const { x: mouseX, y: mouseY } = useMouse({
    type: 'client',
    touch: false
});
const { width: windowWidth, height: windowHeight } = useWindowSize();
const {
    width: summaryCardWidth,
    height: summaryCardHeight
} = useElementBounding(summaryCardRef);

// const actionsItems = ref([[
//         {
//             label: t('common.view_more'),
//             icon: 'i-tabler-eye',
//             click: () => {
//                 showWebsiteModal.value = true;
//                 webToShow.value = props.website;
//             }
//         },
//         {
//             label: t('bookmarks.copy_url'),
//             icon: 'i-tabler-copy',
//             click: () => {
//                 navigator.clipboard.writeText(props.website.url);
//                 showAlert({ message: t('bookmarks.url_copied') });
//             }
//         }
//     ],[
//         {
//             label: t('common.delete'),
//             icon: 'i-tabler-trash',
//             click: () => deleteItems([props.website.objectId])
//         }
//     ]
// ])

// Use computed getter/setter instead of circular watchers for better performance
const checked = computed({
    get: () => sitesSelected.value.some(site => site.objectId === props.website.objectId),
    set: (val) => {
        if (val) {
            // Only add if not already in the array
            if (!sitesSelected.value.some(site => site.objectId === props.website.objectId)) {
                sitesSelected.value.push(props.website);
            }
        } else {
            sitesSelected.value = sitesSelected.value.filter(site => site.objectId !== props.website.objectId);
            if (isMobile.value) showCardOptions.value = false;
        }
    }
});

// Optimized hover handlers using RAF for better Safari performance
let hoverRAF = null;
/**
 * Debounces the modal's Parse prefetch. Without the delay, dragging the pointer
 * across a grid fires a query per card it crosses; with it, only a card the
 * user actually settles on is warmed.
 */
let prefetchTimer = null;
const PREFETCH_HOVER_DELAY = 150;

const handleMouseEnter = () => {
    if (isMobile.value) return;

    // Cancel any pending RAF
    if (hoverRAF) {
        cancelAnimationFrame(hoverRAF);
    }

    // Use RAF to sync with browser's rendering cycle
    hoverRAF = requestAnimationFrame(() => {
        showCardOptions.value = true;
        hoverRAF = null;
    });

    if (props.readonly) return;
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => store.prefetchWebsite(props.website?.objectId), PREFETCH_HOVER_DELAY);
};

const handleMouseLeave = () => {
    if (isMobile.value) return;

    // Cancel any pending RAF
    if (hoverRAF) {
        cancelAnimationFrame(hoverRAF);
    }

    // Use RAF to sync with browser's rendering cycle
    hoverRAF = requestAnimationFrame(() => {
        showCardOptions.value = false;
        hoverRAF = null;
    });

    clearTimeout(prefetchTimer);
};

// Methods
const onMouseOverCard = () => {
    if (isMobile.value) return;

    showMenu.value = true;
    onHover.value = true;

    mouseOverTimer.value = setTimeout(() => {
        if(onHover.value) showSummary.value = true;
  }, 250);
};

const onMouseLeaveCard = () => {
    showSummary.value = false;
    onHover.value = false;
    clearTimeout(mouseOverTimer.value);
};

const handleTouchStart = () => {
    if (props.readonly) return;
    timer.value = setTimeout(() => {
        timer.value = null;
        handleRightClick();
    }, 500);
}

const handleTouchEnd = () => {
    clearTimeout(timer.value);
}

const handleRightClick = () =>{
    showCardOptions.value = true;
    checked.value = true;
}

// Readonly cards keep the browser's own menu (open in new tab, copy link).
const onContextMenu = (event) => {
    if (props.readonly) return;
    event.preventDefault();
    handleRightClick();
};

const dragStart = (website) => {
    draggedWebsite.value = website;
};

const dragEnd = () => {
    draggedWebsite.value = null;
};

const goTo = (url) => {
    window.open(url, '_blank');
};

const setMousePosition = () => {
    try {
        const offsetX = 20;
        const offsetY = 20;
        const width = summaryCardWidth.value || 350;
        const height = summaryCardHeight.value || 0;
        const x = mouseX.value ?? 0;
        const y = mouseY.value ?? 0;
        const viewportWidth = windowWidth.value || 0;
        const viewportHeight = windowHeight.value || 0;

        const translatedX = Math.round(x - viewportWidth + width + offsetX);
        const translatedY = Math.round(y + offsetY);

        const finalX = x >= viewportWidth - width ? translatedX - width - offsetX : translatedX;
        const finalY = y >= viewportHeight - height ? translatedY - height - offsetY : translatedY;

        return `translate3d(${finalX}px, ${finalY}px, 0)`;
    } catch (error) {
        console.log("error setting mouse position: ", error);
        return 'translate3d(0, 0, 0)';
    }
};

const summaryTransform = computed(() => setMousePosition());

const onFaviconError = (event) => {
    const fallback = randomGradient(getGradientSeed('favicon-error'));
    event.target.src = fallback;
    props.website.siteLogo = fallback;
};

const emit = defineEmits(['updateLayout']);

// A tracker pixel or a near-empty sprite loads successfully but renders as a
// blank card, so size is checked alongside the error path; both funnel into
// onImageError, whose chain ends on the deterministic gradient.
const MIN_IMAGE_SIZE = 32;
const isUnusableImage = (img) =>
    !img.naturalWidth || Math.min(img.naturalWidth, img.naturalHeight) < MIN_IMAGE_SIZE;

const onImageLoad = (event) => {
    if (event.target && isUnusableImage(event.target)) return onImageError();
    if (event.target?.src) markLoaded(event.target.src);
    // Kick off blob conversion using the *original* URL (not the blob: URL that
    // event.target.src may already be on a re-mount). The image is now in the
    // browser's HTTP memory cache so fetch() returns instantly with no network hit.
    if (props.cacheImages) preload(setPageImage.value);
    emit('updateLayout');
    if(typeOfImageBeingLoaded.value == 'file'){
        setTimeout(() => {
            emit('updateLayout');
        }, 1000);
    }
};

const onImageError = () => {
    if (srcIndex.value < imageSources.value.length) srcIndex.value++;
};

const getTweet = () => {
    try {
        let tweet = props.website.noEmbedCode;
        tweet = tweet.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        tweet = tweet.replace(/T\d+:\d+:\d+\.\d+Z"/g, '"');
        tweet = tweet.replace('twitter-tweet', 'tweet');
        return tweet;
    } catch (error) {
        return '';
    }
};


const copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        showAlert({message: t('bookmarks.url_copied'), type: 'info'});
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        showAlert({message: t('bookmark_card.copy_url_failed'), type: 'error'});
    }
};

const getDate = (date) => {
  try{
    const userLocale = globalThis.navigator?.language || 'en-GB';
    const options = { year: 'numeric', month: 'numeric', day: 'numeric' };
    // Handle Unix timestamp if date is a number
    if (typeof date === 'number') {
        // Multiply by 1000 if seconds instead of milliseconds
        const timestamp = date.toString().length === 10 ? date * 1000 : date;
        return new Date(timestamp).toLocaleDateString(userLocale, options);
    }
    let newDate = new Date(date).toLocaleDateString(userLocale, options);
    if(newDate == 'Invalid Date') return ''
    return newDate;
  } catch(error){
    return ''
  }
};

const handleCardClick = async (event) => {
    try {
        let url = props.website.url;

        if (props.readonly) {
            if (event.target.tagName != 'A' && /^https?:\/\//i.test(url || '')) window.open(url, '_blank', 'noopener');
            return;
        }

        if(isMobile.value && sitesSelected.value.length > 0){
            checked.value = !checked.value;
            return
        }

        let clickedOnPin = event.target.tagName == 'svg' || event.target.tagName == 'path';
        if (event.target.closest('.reactions-wrapper') || clickedOnPin) return;

        if (event.target.tagName == 'A') return;

        if (event.altKey) {
            copyToClipboard(url);
        } else if(event.metaKey || event.ctrlKey) {
            window.open(url, '_blank');
        } else if (event.shiftKey) {
            checked.value = !checked.value;
        } else if (store.isForeignBoardItem(props.website)) {
            // Someone else's bookmark on a shared board: its row is theirs and
            // the modal would load it by id, so go to the page itself.
            if (/^https?:\/\//i.test(url || '')) window.open(url, '_blank', 'noopener');
        } else {
            showWebsiteModal.value = true;
            let selectedCard = document.getElementById('bookmarkCard-' + props.website.objectId);
            cardPosition.value = selectedCard.getBoundingClientRect();
            cardPosition.value.el = cardPosition.value;
            webToShow.value = props.website;
            sitesSelected.value.length == 0 ? showModal.value = true : checked.value = !checked.value;
        }
    } catch(error) {
        console.log("error on handleCardClick: ", error);
    }
};


// Computed

const type = computed(() => {
    return props.website.type;
});

const getMediaSummary = computed(() => {
    try {
        switch (type.value) {
            case 'movie':
                return props.website.mediaTypeObject.overview ? props.website.mediaTypeObject.overview : '';

            case 'game':
                return props.website.mediaTypeObject.summary ? props.website.mediaTypeObject.summary : '';

            default:
                break;
        }
    } catch (error) {
        return false;
    }
});

// Every hover effect on the card is pointer-only. A touch screen emulates
// hover on tap and then latches it until something else is tapped, which left
// cards lifted and footers hanging open with no way to dismiss them.
const hoverEnabled = computed(() => !isMobile.value);

// The tag row painted over the bottom of the preview image. Grid view lifts the
// image on hover so this row stays clear of the rising title, so the card needs
// to know whether any tags are going to show at all (see `.no-preview-tags`).
const showPreviewTags = computed(() =>
    type.value != 'tweet'
    && type.value != 'textNote'
    && type.value != 'game'
    && !!userOptions.value.previewTags
    && userOptions.value.displayMode != 'compact'
);

const isShopping = computed(() => {
    return props.website.subType ? props.website.subType.includes('shopping') : false;
});

const isTweet = computed(() => {
    return props.website.subType ? (props.website.subType.includes('tweet')) && props.website.noEmbedCode : false;
});


const imgLoading = computed(() => isLoaded(setPageImage.value) ? 'eager' : 'lazy');

// Multi-image bookmarks. The count comes off the search document (imageCount),
// because the grid lists from Meilisearch and the images array is not indexed.
const imageCount = computed(() =>
    props.website?.type === 'image' || isSocialMedia.value ? bookmarkImageCount(props.website) : 1
);

// A social post that came with pictures. Grid view only: list and compact rows
// are a title and a thumbnail, and a post's title is what makes its row legible.
// A saved tweet that still carries its oEmbed markup keeps the embed card.
const NOT_SOCIAL_MEDIA = ['image', 'textNote', 'drawing', 'pdf', 'audio', 'game', 'movie', 'music', 'spotify', 'youtube'];
const socialPlatform = computed(() => socialPlatformFromUrl(props.website?.url));
const socialBrand = computed(() => SOCIAL_BRANDS[socialPlatform.value]);
const isSocialMedia = computed(() => {
    if (!isGridView.value || isTweet.value || NOT_SOCIAL_MEDIA.includes(props.website?.type)) return false;
    if (!socialPlatform.value) return false;
    const cover = bookmarkCoverUrl(props.website);
    // A profile picture is the only image some text posts have, and it is not
    // a picture *of* the post.
    return !!cover && !isAvatarURL(cover);
});

// What the hover shows. The backend composes the title as "@handle: first line"
// for posts that have no headline of their own, so it is split back apart here
// rather than printing the handle twice.
const socialInfo = computed(() => {
    const site = props.website;
    const title = (site.siteTitle || '').trim();
    const composed = title.match(/^((?:@|[ur]\/)[\w.-]+):\s*([\s\S]*)$/);
    const author = (site.siteAuthor && site.siteAuthor !== 'null' ? site.siteAuthor : composed?.[1]) || '';
    const text = composed ? composed[2] : (site.siteDescription || title);
    return { author, text: text.trim() };
});

// The pictures behind the cover. A bookmark loaded from Parse has the whole
// `images` array; a grid card listed from Meilisearch only has the two URLs
// the indexer writes as `imageThumbs`.
const stackImages = computed(() => {
    const site = props.website;
    const fromArray = Array.isArray(site?.images) ? site.images.slice(1, 3).map(image => image?.url) : [];
    const urls = fromArray.length ? fromArray : (site?.imageThumbs || []).slice(0, 2);
    return urls.filter(Boolean).map(url => getCachedSrc(url));
});

// ---- Audio ----------------------------------------------------------------
// ---- App ------------------------------------------------------------------
// An App Store / Google Play page. The summary rides on its own `appCard`
// column (search document and Parse row alike); the icon, name and developer
// are the ordinary `siteLogo`, `siteTitle` and `siteAuthor`.
const appCard = computed(() => {
    const card = props.website?.appCard;
    return card && (card.store === 'appstore' || card.store === 'playstore') ? card : null;
});
const isApp = computed(() => !!appCard.value && props.website?.type !== 'game' && props.website?.type !== 'movie');
const isAppCard = computed(() => isApp.value && isGridView.value);
const appTagline = computed(() => appCard.value?.subtitle || appCard.value?.category || '');
const appRating = computed(() => (typeof appCard.value?.rating === 'number' ? appCard.value.rating : null));
const appRatingCount = computed(() => {
    const count = appCard.value?.ratingCount;
    // "43M", as the store prints it: two significant digits, upper-case suffix.
    return count ? new Intl.NumberFormat(locale.value, { notation: 'compact' }).format(count).replace(/(\d)([a-z]+)$/, (_m, d, unit) => d + unit.toUpperCase()) : '';
});
const appShots = computed(() => (Array.isArray(appCard.value?.screenshots) ? appCard.value.screenshots.filter(Boolean).slice(0, 3) : []));

const isAudio = computed(() => props.website?.type === 'audio');
const audioIsVoiceNote = computed(() => isVoiceNote(props.website));
const audioLength = computed(() => audioDurationLabel(props.website));
const audioBars = computed(() => (isAudio.value ? audioPeaks(props.website, 48) : []));
const audioTranscribing = computed(() => isTranscribing(props.website));

// The opening of the transcript, which is what a recording is actually about —
// the title is a filename or a timestamp on most of them.
const audioExcerpt = computed(() => {
    const text = transcriptText(props.website);
    return text ? text.slice(0, 180) : '';
});

// "PDF" on its own when the document could not be read for a page count —
// a scan behind an encrypted wrapper, or one that arrived truncated.
const pdfBadgeLabel = computed(() => {
    const pages = Number(props.website?.pageCount);
    if (!Number.isFinite(pages) || pages <= 0) return 'PDF';
    return pages === 1 ? t('bookmarks.pdf_page_one') : t('bookmarks.pdf_page_count', { n: pages });
});

const setMusicImage = computed(() => {
    try {
        let image = props.website.OGImage ? props.website.OGImage : (typeof props.website.siteScreenshot.url === 'function' ? props.website.siteScreenshot.url() : props.website.siteScreenshot.url);
        return image;
    } catch(error) {
        return randomGradient(getGradientSeed('music'));
    }
});

// Best source first; the gradient is what setPageImage falls back to once
// the list runs out, so the chain always ends on something that loads.
const imageSources = computed(() => bookmarkImageSources(props.website, !!userOptions.value.screenshotAsThumbnail));

const currentSource = computed(() => imageSources.value[srcIndex.value]);
const typeOfImageBeingLoaded = computed(() => currentSource.value?.[0] ?? 'gradient');
const setPageImage = computed(() => currentSource.value?.[1] ?? randomGradient(getGradientSeed('page')));

// True when the image chain has run out for a drawing: no OGImage was ever
// written (export skipped on a tainted canvas, or the upload failed) or every
// source 404'd. `typeOfImageBeingLoaded` is 'gradient' exactly in that case.
const isDrawingWithoutPreview = computed(
    () => type.value === 'drawing' && typeOfImageBeingLoaded.value === 'gradient'
);

const isMusic = computed(() => {
    let subType = props.website.subType ? props.website.subType.includes('music') || props.website.subType.includes('spotify') : false;
    let type = props.website.type ? props.website.type == 'music' || props.website.type == 'spotify' : false;
    return type || subType;
});

const getGameDeveloper = computed(() => {
    try {
        if (type.value == 'game' && props.website.mediaTypeObject.involved_companies) {
            return props.website.mediaTypeObject.involved_companies.find(company => company.developer)?.company || false;
        } else {
            return false;
        }
    } catch (error) {
        console.log("error: ", error);
        return false;
    }
});

// Runs during SSR too, so no DOM: strip hrefs with a regex instead of a temp element.
// ponytail: an <a> that already carries class= ends up with two class attrs; the browser keeps ours (first).
const sanitizedTextNote = computed(() =>
    (props.website.textNote || '').replace(/<a\b[^>]*>/gi, tag =>
        tag.replace(/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/^<a\b/i, '<a class="disabled-link"')));

// cachedPageImage resolves to a blob: URL once the image has been loaded and
// converted, falling back to the original URL on first render.
// Vue tracks the reactive blobSrcs Map inside getCachedSrc, so this computed
// re-evaluates automatically when the blob becomes ready.
const cachedPageImage = computed(() => getCachedSrc(setPageImage.value))

const getGradientSeed = (suffix = '') => {
    return [
        props.website.objectId || props.website.id || props.website.url || props.website.siteTitle || 'bookmark',
        suffix
    ].filter(Boolean).join('-');
}

// On re-mount (virtual scroller bringing the card back), preload is a no-op
// if the blob is already cached. If this is truly the first mount and the
// image happens to already be in the blob cache from a sibling card with the
// same URL, getCachedSrc returns the blob URL immediately.
const cardRootRef = ref(null);

onMounted(() => {
  // Cards are server-rendered, so an image can finish (or fail) before hydration
  // attaches @load/@error — those events never reach us and the broken icon stays
  // on screen. Re-check whatever already settled.
  cardRootRef.value?.querySelectorAll('img.card-image').forEach((img) => {
    if (img.complete && isUnusableImage(img)) onImageError();
  });
  if (props.cacheImages) preload(setPageImage.value)
})

</script>


<style>
    @reference "../assets/css/tailwind.css";

    /* @import "tailwindcss";
    @import "@nuxt/ui"; */

    .stack{
        @apply
            shadow-none!
            bg-transparent!
            ring-0!
            border-0!
            scale-110
        ;
    }

    .summary-mouse-follow {
      position: fixed;
      z-index: 10;
      top: 0px;
      right: 0px;
      width: 350px;
      height: fit-content !important;
      transform-origin: -200% 100%;
      pointer-events: none;
      will-change: transform;
      backface-visibility: hidden;
      transform-style: preserve-3d;
      transition: 150ms;
    }

    .bookmark-card-base{
        @apply
            relative
            flex flex-col
            w-full h-full
            rounded-xl
            cursor-pointer
            active:scale-95
            select-none
            bg-white dark:bg-neutral-900
            shadow-md shadow-neutral-200/50 dark:shadow-black/20
            ring ring-1 ring-neutral-200/30 dark:ring-neutral-700/30
            overflow-hidden
            transition-all

            [&.grid-item]:aspect-[16/12]
        ;
    }

    /* ----------------------------------------------------------------
       HOVER — every rule below is pointer-only. `.mobile` comes off the
       store's viewport flag, and on a touch screen hover is emulated on
       tap and then latches, so the card would sit lifted with its footer
       open until something else was tapped. The group-hover choreography
       is switched off the same way, by not installing `group/grid` on the
       card at all (see the template).
       ---------------------------------------------------------------- */
    .bookmark-card-base:not(.mobile):hover{
        @apply shadow-lg;
    }

    .bookmark-card-base.grid-item:not(.mobile):hover{
        @apply shadow-xl;
    }

    .card-header{
        @apply 
            flex
            overflow-hidden
            h-full w-full
            transition-transform

            group-has-[&.text-note]:group-hover/grid:translate-y-0!
            group-has-[&.image]:group-hover/grid:scale-105

            group-has-[.list-item:not(.image):not(.text-note):not(.media):not(.spotify):not(.drawing):not(.audio)]:hidden

            group-has-[&.list-item]:max-h-22
            /* group-has-[.list-item&.image]:max-h-[42px] */
        ;
    }

    /* The lift is what keeps the tag row clear of the title sliding up from
       below. With no tags to make room for (`.no-preview-tags`) it only
       shunts the picture around for nothing, so the card holds still — and
       the title/footer that rise with it are pinned down further below.
       A website card always lifts: its URL row needs the room. */
    .bookmark-card-base.grid-item:not(.media):not(.mobile):not(.no-preview-tags:not(.website)):hover > .card-header{
        @apply -translate-y-4;
    }

    /* ----------------------------------------------------------------
       READONLY (public shared board) — the grid's hover choreography
       (lift the image, raise the title, slide the footer up) is for the
       owner's cards; here the card holds still. Tailwind v4 moves things
       with the `translate` property, so `transform: none` alone would not
       stop it. The URL row keeps exactly one line of room under the
       description and fades in on hover, so nothing shifts. Touch screens
       have no hover, so there it stays visible.
       ---------------------------------------------------------------- */
    .bookmark-card-base.readonly.grid-item{
        aspect-ratio: auto !important;
    }

    .bookmark-card-base.readonly > .card-header{
        height: auto !important;
        aspect-ratio: 16 / 10;
        transform: none !important;
        translate: none !important;
    }

    /* An app card is its own height: header row plus screenshots, not the
       grid's 4:3 default. */
    .bookmark-card-base.app.grid-item{
        aspect-ratio: auto !important;
        height: auto !important;
    }

    .bookmark-card-base.app > .card-header{
        height: auto !important;
        /* aspect-ratio: auto !important; */
    }

    .bookmark-card-base.readonly .card-body-content{
        transform: none !important;
        translate: none !important;
    }

    .bookmark-card-base.readonly .card-description{
        -webkit-line-clamp: 2;
    }

    .bookmark-card-base.readonly .footer-bookmark-card{
        position: static !important;
        width: 100% !important;
        height: 1rem;
        padding-top: 0;
        margin-top: 0.25rem;
        transform: none !important;
        translate: none !important;
        opacity: 0 !important;
    }

    .bookmark-card-base.readonly:hover .footer-bookmark-card,
    .bookmark-card-base.readonly:focus-within .footer-bookmark-card,
    .bookmark-card-base.readonly.mobile .footer-bookmark-card{
        opacity: 0.7 !important;
    }

    @media (hover: none){
        .bookmark-card-base.readonly .footer-bookmark-card{
            opacity: 0.7 !important;
        }
    }

    /* The link glyph is a 24px icon in a 12px slot; unchecked it props the
       row open to ~20px. */
    .bookmark-card-base.readonly .bookmark-favicon{
        width: 0.75rem;
        height: 0.75rem;
    }
    .bookmark-card-base.readonly .bookmark-favicon > *{
        width: 100% !important;
        height: 100% !important;
    }

    .card-image-count{
        @apply opacity-0 transition-opacity group-hover:opacity-100;
        @apply absolute top-2 right-2 z-10 flex items-center gap-1;
        @apply px-1.5 py-0.5 rounded-md text-xs font-medium tabular-nums;
        @apply bg-neutral-50 dark:bg-neutral-800 dark:text-white pointer-events-none shadow-xs;
        /* @apply bg-black/55 text-white backdrop-blur-sm pointer-events-none; */
    }

    /* A social post's hover: who posted and what they said, over the top of the
       picture. The tag row owns the bottom edge, and the picture count the
       top-right corner, hence the extra right padding on the stacked variant. */
    .social-hover{
        @apply absolute inset-0 z-[2] flex flex-col gap-1.5 px-5 pt-8 pb-5 rounded-xl text-white;
        @apply opacity-0 transition-opacity duration-200 pointer-events-none overflow-hidden;
        background: linear-gradient(to bottom, rgb(0 0 0 / 0.72), rgb(0 0 0 / 0.3) 55%, transparent);
    }
    .bookmark-card-base:not(.mobile):hover .social-hover{ @apply opacity-100; }
    .social-hover-head{ @apply flex items-center gap-1.5 text-xs font-semibold; }
    .social-hover-logo{ @apply size-4 shrink-0 rounded-[3px]; }
    .social-hover-author{ @apply truncate; }
    .social-hover-text{ @apply m-0 text-xs leading-snug line-clamp-3 text-white/90; }

    /* The platform's mark: a small rounded square in the cover's top-right corner. */
    .card-social-badge{
        @apply absolute top-2 right-2 z-[3] grid size-6 place-items-center rounded-md;
        @apply bg-white/90 text-neutral-900 ring-1 ring-black/5 shadow-sm backdrop-blur-sm pointer-events-none;
        @apply dark:bg-neutral-900/85 dark:text-white dark:ring-white/10;
    }
    .bookmark-card-base.stack .card-social-badge{ top: calc(10% + 24px); right: calc(10% + 16px); }

    /* On the stacked mat the cover is inset and wears a 6px border, so the overlay follows it. */
    .bookmark-card-base.stack .social-hover{ inset: calc(10% + 6px); border-radius: 0.375rem; padding: 1.25rem 2.75rem 1rem 1.25rem; }

    /* Grid cards lift 16px on hover to clear the title rising from below. A
       picture-only card has no title, and the lift just uncovers a white strip
       at the bottom. */
    .bookmark-card-base.social-media.grid-item:hover > .card-header{ @apply translate-y-0!; }

    /* Bottom-left, not top-right: a PDF cover is a page of text, and the top
       right corner is where a header or a page number usually sits. */
    .card-pdf-badge{
        @apply top-auto right-auto bottom-2 left-2 uppercase tracking-wide;
    }

    /* ---- Audio ----------------------------------------------------------
       The face of a recording. A flat tinted panel rather than the gradient
       every other coverless type falls back to, because the waveform is the
       picture here and a gradient behind it reads as a photo that failed to
       load. */
    .card-audio{
        @apply
            relative flex flex-col justify-center gap-2
            h-full w-full p-4
            bg-neutral-100 dark:bg-neutral-800
        ;
    }

    /* ---- App ------------------------------------------------------------
       The store's own card: a header row (icon, name, tagline, stars, View)
       over a row of screenshots, on the card's own surface. */
    .card-app{
        @apply flex h-full w-full flex-col gap-3 p-3.5 bg-white dark:bg-neutral-900;
    }

    .card-app-top{
        @apply flex items-center gap-3;
    }

    .card-app-icon{
        @apply size-16 shrink-0 select-none rounded-[22%] bg-neutral-100 object-cover;
        @apply ring-1 ring-black/10 dark:ring-white/15;
    }

    .card-app-text{
        @apply flex min-w-0 flex-1 flex-col gap-0.5;
    }

    .card-app-title{
        @apply m-0 text-[15px] font-semibold leading-tight text-neutral-900 dark:text-neutral-50 line-clamp-2;
    }

    .card-app-tagline{
        @apply m-0 text-[13px] leading-tight text-neutral-500 dark:text-neutral-400 line-clamp-1;
    }

    .card-app-rating{
        @apply m-0 mt-0.5 flex items-center gap-1 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400;
    }

    /* Five stars, the filled share drawn over the grey ones. */
    .card-app-stars{
        @apply relative inline-block whitespace-nowrap text-[11px] leading-none tracking-[0.5px] text-neutral-300 dark:text-neutral-600;
    }
    .card-app-stars-fill{
        @apply absolute inset-y-0 left-0 overflow-hidden text-neutral-500 dark:text-neutral-400;
    }

    .card-app-view{
        @apply shrink-0 rounded-full px-4 py-1.5 text-sm font-bold no-underline;
        @apply bg-sky-50 text-sky-600 hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-400 dark:hover:bg-sky-500/25;
        @apply transition-colors;
    }

    .card-app-shots{
        @apply grid gap-2;
    }

    .card-app-shot{
        @apply aspect-[9/19] w-full select-none rounded-xl bg-neutral-100 object-cover object-top;
        @apply ring-1 ring-black/10 dark:bg-neutral-800 dark:ring-white/15;
    }

    /* The body is the card's own, so the grid's hover lift (which makes room
       for a title rising from below) has nothing to clear. */
    .bookmark-card-base.app.grid-item:hover > .card-header{ @apply translate-y-0!; }

    .card-audio-wave{
        @apply flex flex-row items-center gap-[2px] h-14 w-full;
    }

    .card-audio-bar{
        @apply flex-1 min-w-[2px] rounded-full bg-neutral-400/70 dark:bg-neutral-500/70;
    }

    .card-audio-meta{
        @apply
            flex flex-row items-center gap-1.5
            text-xs font-medium tabular-nums
            text-neutral-500 dark:text-neutral-400
        ;
    }

    .card-audio-excerpt{
        @apply
            text-xs leading-snug
            text-neutral-600 dark:text-neutral-300
            line-clamp-3
        ;
    }

    .card-audio-status{
        @apply
            flex flex-row items-center gap-1.5
            text-xs text-neutral-500 dark:text-neutral-400
        ;
    }

    /* A recording on one line in the list view: the waveform is the only part
       worth keeping, and the excerpt belongs to the row's own text column.
       `.list-item` and `.audio` are both on the card root, which is why the
       header above has to spare `.audio` from the list-view hide. */
    .bookmark-card-base.list-item .card-audio-excerpt,
    .bookmark-card-base.list-item .card-audio-status{
        @apply hidden;
    }

    .bookmark-card-base.list-item .card-audio{
        @apply p-2 gap-1;
    }

    .bookmark-card-base.list-item .card-audio-wave{
        @apply h-8;
    }

    .card-image{
        @apply
            select-none
            w-full
            h-full
            object-cover
            min-h-[120px]
            max-h-[600px]
            transition-transform duration-300

            group-has-[.list-item&.image]:min-h-0
            group-has-[&.media]:blur-lg
            group-has-[&.media]:scale-130
            group-has-[&.media]:brightness-80
            group-has-[&.media]:grayscale-20
        ;

        user-drag: none;
        image-rendering: -webkit-optimize-contrast;
    }

    /* ----------------------------------------------------------------
       GRID VIEW — multi-image: the cover sits on a white mat with two
       blank cards fanned out behind it, and the fan opens on hover. The
       cards behind hold the next two pictures (`imageThumbs` off the search
       document, or the `images` array when the bookmark came from Parse),
       falling back to blank cards when neither is there.
       ---------------------------------------------------------------- */
    .bookmark-card-base.stack{
        .card-image-stage{
            @apply relative flex items-center justify-center p-[10%];
        }

        .stack-back{
            @apply absolute inset-[10%] overflow-hidden rounded-xl bg-white dark:bg-neutral-800;
            @apply border-[6px] border-white dark:border-neutral-800;
            @apply shadow-md shadow-black/10 ring-1 ring-black/5;
            @apply transition-transform duration-300 ease-out;
        }
        .stack-back img{
            @apply h-full w-full rounded-md object-cover select-none;
        }
        .stack-back-1{ transform: rotate(-5deg); }
        .stack-back-2{ transform: rotate(4deg); }

        .card-image{
            @apply relative z-[1] min-h-0 rounded-xl;
            @apply border-[6px] border-white dark:border-neutral-800;
            @apply shadow-lg shadow-black/15;
        }

        &:not(.mobile):hover .stack-back-1{ transform: rotate(-8deg) translate(-3%, -2%); }
        &:not(.mobile):hover .stack-back-2{ transform: rotate(7deg) translate(3%, 0%); }
    }

    /* ----------------------------------------------------------------
       LIST VIEW — image: the picture fills the compact row and scales
       up slightly on hover (header clips the overflow).
       ---------------------------------------------------------------- */
    .image.list-item{
        .card-image{
            @apply min-h-0! max-h-full;
        }

        &:not(.mobile):hover .card-image{
            @apply scale-105;
        }
    }

    /* GRID VIEW — the same zoom for every other card with a picture. Image
       cards get it from the header scaling; media and music run their own
       hover on .card-image, and a scale here would override it. */
    .grid-item:not(.image):not(.media):not(.spotify):not(.mobile):hover .card-image{
        @apply scale-105;
    }

    .card-content,
    .card-body-content{
        @apply 
            flex gap-0
            flex-col gap-0.5
            transition-all
            py-2.5 px-3

            group-hover/grid:-translate-y-5.5

            group-has-[.list-item]:gap-0.5
            group-has-[.list-item]:pl-13
            group-has-[.list-item]:flex-col-reverse
        ;
    }

    .footer-bookmark-card{
        @apply  
            flex flex-row justify-between items-center
            font-light
            transition-all
            opacity-70

            group-has-[.grid-item]:w-[calc(100%-1.5rem)]
            group-has-[.grid-item]:absolute
            group-has-[.grid-item]:bottom-0
            group-has-[.grid-item]:left-3
            group-has-[.grid-item]:opacity-0
            group-hover/grid:translate-y-3.5!
            group-hover/grid:opacity-100!

            group-has-[.list-item]:w-full
            group-has-[.list-item]:gap-2
            group-has-[.list-item]:justify-start
        ;

        &.compact-only-footer{
            @apply hidden;
        }
    }

    /* ----------------------------------------------------------------
       NO TAG PREVIEW — the grid hover is one movement: the image lifts,
       the title rises into the gap it leaves, and the link/date row
       surfaces at the bottom. It exists to clear the tag row painted over
       the image. With tags switched off there is nothing to clear, so the
       whole movement is held: lifting the title without the image would
       drop it straight onto the picture, and the footer has no room to
       surface into. Website cards skip the hold: the URL in the footer is
       what their hover is for.
       ---------------------------------------------------------------- */
    .bookmark-card-base.grid-item.no-preview-tags:not(.website):hover{
        .card-content,
        .card-body-content{
            @apply translate-y-0;
        }

        .footer-bookmark-card{
            @apply translate-y-0! opacity-0!;
        }
    }

    .link-card-wrpapper{
        @apply
            flex flex-row items-center justify-center gap-1
            truncate
            overflow-hidden
        ;
    }

    .bookmark-favicon{
        @apply
            size-3
            rounded-sm

            group-has-[.list-item]:absolute
            group-has-[.list-item]:size-8
            group-has-[.list-item]:left-2.5
            group-has-[.list-item]:top-1/2
            group-has-[.list-item]:-translate-y-1/2
        ;
    }

    .card-title{
        @apply
            relative
            overflow-hidden
            text-sm
            font-normal
            truncate
            break-words
            w-full
            -mb-1
            last:mb-0
        ;
    }

    .tags-wrapper-card{
        @apply
            flex flex-row flex-wrap items-center
            gap-y-1 gap-x-1
            absolute
            bottom-0 left-0
            pl-2 pb-2
            opacity-0
            transition-all
            w-[80%]

            group-hover/grid:opacity-100

            /* group-has-[.list-item]:hidden */
            group-has-[.list-item&.image]:hidden
            
            group-has-[&.image]:mb-1
            group-has-[&.image]:ml-1.5
        ;
    }

    .card-link{
        @apply
            truncate
            text-xs!
        ;
    }

    .card-text-note-preview{
        /* Clamp + fade, no flex: the note body is a run of block elements,
           and a flex container turns each one into its own narrow column.
           Tailwind also emits `display:flex` after line-clamp's
           `display:-webkit-box`, which kills the clamp outright. */
        @apply 
            line-clamp-[12] 
            h-full max-h-42 
            overflow-hidden
            transition-all
        ;

        > * + * {
            @apply mt-1;
        }

        .disabled-link {
            @apply underline;
        }

        .tiptap-image{
            @apply mt-2;
        }

        ul{
            @apply space-y-2 pt-1;
        }

        h1{
            @apply font-semibold mb-1 text-xl;
        }

        pre{
            white-space: pre-wrap;
        }

        img{
            @apply rounded-md w-full mb-2;

            &[alt="small"]{
                width: 20%;
            }
        }
    }

    /* Nudges the note down so the first line clears the card edge. Pointer-only
       like the rest; the list row cancels it again further below. */
    .bookmark-card-base:not(.mobile) .card-text-note-preview:hover{
        @apply translate-y-2;
    }

    .card-text-note{
        /* Block, not flex: one full-size child needs no flex context, and
           flex here is what fanned the note out into columns. */
        @apply
            relative
            block
            h-full w-full
            px-4 pt-4
            overflow-hidden
        ;

        /* gradient */
        &::after {
            @apply
                content-['']
                absolute
                bottom-0
                left-0
                right-0
                h-[20px]
                bg-gradient-to-b from-transparent to-white
                pointer-events-none
                rounded-b-lg
                transition-all
                z-1
            ;

            @media screen and (prefers-color-scheme: dark) {
                @apply to-neutral-900;
            }
        }
    }

    /* ----------------------------------------------------------------
       DRAWING — the card shows the board's exported PNG, so it renders
       through the ordinary image path. What it needs on top of that is a
       neutral mat: an export is transparent-cornered and mostly white
       space, and letting it bleed to the card edge makes a light sketch
       look like a rendering failure. `contain` also keeps the drawing's
       proportions, which a crop would quietly lie about.
       ---------------------------------------------------------------- */
    .drawing{
        .card-image{
            @apply object-contain p-2;
            background-color: theme('colors.neutral.50');
        }

        @media screen and (prefers-color-scheme: dark) {
            .card-image{
                background-color: theme('colors.neutral.900');
            }
        }
    }

    /* The list row caps the header at max-h-22, so the 120px floor the grid
       needs has to come off here or the board is clipped instead of scaled —
       the same trade `.image.list-item` makes. */
    .drawing.list-item{
        .card-image{
            @apply p-1 min-h-0! h-22!;
        }

        .card-drawing-placeholder{
            @apply min-h-0 h-22;
        }
    }

    .card-drawing-placeholder{
        @apply flex items-center justify-center w-full h-full min-h-[120px];
        background-color: theme('colors.neutral.50');
        color: theme('colors.neutral.400');

        @media screen and (prefers-color-scheme: dark) {
            background-color: theme('colors.neutral.900');
            color: theme('colors.neutral.600');
        }
    }

    /* ----------------------------------------------------------------
       LIST VIEW — text note: shorter preview, taller fade so the clipped
       text dissolves cleanly into the row background (matches grid).
       ---------------------------------------------------------------- */
    .text-note.list-item{
        .card-text-note{
            @apply px-3 pt-2.5 pb-1;
        }

        .card-text-note-preview{
            @apply line-clamp-3 max-h-full hover:translate-y-0;
        }

        .card-text-note::after{
            @apply h-8;
        }
    }

    .games-bookmark-card-overview{
        @apply
            absolute
            bottom-0 left-0
            w-full h-full
            z-2
            overflow-hidden
        ;

        &::after{
            @apply
                content-['']
                absolute inset-0
                bg-gradient-to-t from-black/85 via-black/10 to-transparent
                opacity-0
                transition-opacity duration-300
                pointer-events-none
            ;
        }
    }

    .game-movie-thumbnail{
        @apply
            absolute inset-0
            h-full w-full
            object-cover
            transition-transform duration-300
        ;
    }

    .games-bookmark-card{
        @apply
            absolute z-1
            right-3 bottom-3 left-3
            text-white
            translate-y-[calc(100%+0.75rem)]
            opacity-0
            transition-all duration-300
        ;
    }

    .games-bookmark-card-content{
        @apply
            flex flex-col gap-1
        ;

        .title{
            @apply
                text-base font-semibold
                line-clamp-[2]
            ;
        }

        .overview{
            @apply text-sm leading-snug text-white/80 line-clamp-3;
        }
    }

    .media-type-tab{
        @apply
            absolute z-2
            right-3 bottom-3
            flex size-7 items-center justify-center
            rounded-lg
            bg-black/65 text-white
            backdrop-blur-sm
            shadow-lg
            transition-transform duration-300
        ;
    }

    .bookmark-card-base.media.grid-item:not(.mobile):hover{
        .game-movie-thumbnail{ @apply scale-105; }
        .games-bookmark-card-overview::after{ @apply opacity-100; }
        .games-bookmark-card{ @apply translate-y-0 opacity-100; }
        .media-type-tab{ @apply -translate-y-24; }
    }

    /* ----------------------------------------------------------------
       LIST VIEW — game & movie: poster thumbnail on the left, title /
       date / overview on the right. Drops the blurred backdrop used in
       grid view in favour of a clean row.

       Uses `!` on layout-critical properties so the grid-view base rules
       (.card-image blur/scale, .games-bookmark-card-overview absolute,
       etc.) can never win on the cascade.
       ---------------------------------------------------------------- */
    .bookmark-card-base.media.list-item{

        /* Constrain the whole row to a compact, fixed height */
        & .card-header{
            @apply h-22! max-h-22!;
        }

        & > .card-header > div{
            @apply h-full!;
        }

        /* Kill the blurred full-bleed backdrop image entirely in list rows */
        & .card-image{
            @apply hidden!;
        }

        /* Overview becomes the flow row: poster left, text right */
        & .games-bookmark-card-overview{
            @apply
                static!
                flex! flex-row!
                w-full! h-full!
                p-2!
                items-center! gap-3!
                overflow-visible!
            ;

            &::after{ @apply hidden; }
        }

        & .game-movie-thumbnail{
            @apply
                static!
                h-full! w-auto!
                aspect-[3/4]!
                shrink-0!
                rounded-md
                shadow-sm
                transition-transform duration-300
            ;
        }

        & .games-bookmark-card{
            @apply
                static!
                translate-y-0! opacity-100!
                flex-1! min-w-0!
                bg-transparent! dark:bg-transparent!
                backdrop-blur-none!
                shadow-none! ring-0!
                p-0! pr-2!
                text-neutral-900 dark:text-neutral-100
            ;
        }

        & .games-bookmark-card .overview{
            @apply
                line-clamp-1 text-sm
                text-neutral-600 dark:text-neutral-400
            ;
        }

        & .games-bookmark-card-content{
            @apply gap-0!;
        }

        & .games-bookmark-card-content .title{
            @apply
                text-neutral-900! dark:text-neutral-100!
                line-clamp-1
                text-sm
            ;
        }

        & .media-type-tab{ @apply hidden; }
    }

</style>
