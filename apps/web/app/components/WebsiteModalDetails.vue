<template>
    <div
        ref="sidebarRoot"
        class="site-options-parent"
        :class="{
            'site-options-parent--open': showSideBarOptions,
            'site-options-parent--resizing': isResizing,
            'site-options-parent--sized': showSideBarOptions && !isMobile && sidebarWidth != null
        }"
        :style="showSideBarOptions && !isMobile && sidebarWidth != null ? { width: sidebarWidth + 'px' } : null"
    >
        <!-- Mobile: the panel covers the whole modal, so it carries its own bar
             to get back out of — the native card presents Details the same way. -->
        <div v-if="isMobile" class="details-mobile-header">
            <div class="details-mobile-grabber">
                <div class="mobile-drag-bar"/>
            </div>
            <div class="details-mobile-bar">
                <span class="details-mobile-title">{{ t('website_modal.details') }}</span>
                <UButton
                    variant="ghost"
                    color="neutral"
                    icon="i-heroicons-x-mark"
                    square
                    size="md"
                    :aria-label="t('common.close')"
                    @click="showSideBarOptions = false"
                />
            </div>
        </div>

        <div class="site-options-wrapper">
            <!-- Page Title - Name -->
             <section class="details-field">
                <div class="details-field">
                    <!-- <label class="details-field-label">
                        {{ t('bookmark_details.details_title') }}
                    </label> -->
                    <UInput
                        v-model="siteTitleLocal"
                        @focus="isEditingTitle = true"
                        @blur="isEditingTitle = false"
                        @update:model-value="debounce(() => saveUpdatedSite(webToShow.objectId, 'siteTitle', siteTitleLocal), 250)"
                        variant="ghost"
                        size="sm"
                        class="details-input"
                        :placeholder="$t('bookmark_details.details_title')"
                    />
                </div>

                <!-- URL -->
                <div v-if="webToShow.url && webToShow.url.length > 1" class="details-field pt-1">
                    <!-- <label class="details-field-label">URL</label> -->
                    <!-- class="details-input" -->
                    <UInput
                        :model-value="webToShow.url"
                        readonly
                        variant="ghost"
                        size="xs"
                        :ui="{ trailing: 'pe-1' }"
                    >
                        <template #trailing>
                            <UButton
                                :to="webToShow.url"
                                target="_blank"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                square
                                icon="i-heroicons-arrow-top-right-on-square"
                            />
                        </template>
                    </UInput>
                    <span class="details-field-hint">
                        {{ t('bookmark_details.added') }} {{ getDaysFromNow }}
                    </span>
                </div>
            </section>

            <!-- Preview thumbnail with file-type badge -->
            <!-- <section v-if="getPreviewImage" class="details-preview">
                <img
                    :src="getPreviewImage"
                    class="details-preview-img"
                    @click="webToShow.type == 'image' ? downloadImage(getImgUrl) : null"
                />
                <span v-if="getFileTypeBadge" class="details-preview-badge">
                    {{ getFileTypeBadge }}
                </span>
            </section> -->

            <!-- Main Colors (swatch dots) -->
            <section
                v-if="webToShow.siteColors != undefined && webToShow.siteColors.length > 0"
                class="details-section"
            >
                <div class="color-dots-wrapper">
                    <div
                        v-for="color in webToShow.siteColors"
                        :key="color.hex"
                        :style="{ backgroundColor: color.hex }"
                        class="color-dot"
                        @click="copyColor(color)"
                    >
                        <p class="hex-color-popups">
                            {{ getColorName(color) }}
                        </p>
                    </div>
                </div>
            </section>

            <!-- Image download (image bookmarks only) -->
            <section v-if="webToShow.type == 'image'" class="details-section">
                <UButton
                    block
                    color="neutral"
                    variant="soft"
                    size="lg"
                    class="details-pill-btn"
                    icon="i-heroicons-arrow-down-tray"
                    @click="downloadImage(getImgUrl)"
                >
                    {{ t('bookmark_details.download_image') }}
                </UButton>
            </section>

            <!-- Notes -->
            <section class="details-field">
                <UTextarea
                    v-model="webToShow.siteNotes"
                    :rows="3"
                    autoresize
                    variant="none"
                    :placeholder="$t('bookmark_details.notes_placeholder')"
                    class="details-notes"
                    :ui="{ base: 'resize-none w-full' }"
                    @focus="pageNotesFocused = true"
                    @blur="pageNotesFocused = false"
                    @update:model-value="debounce(() => saveUpdatedSite(webToShow.objectId, 'siteNotes', webToShow.siteNotes), 400)"
                />
            </section>

            <hr class="details-divider" />

            <!-- Tags list -->
            <section class="details-section">
                <h6 class="details-section-title">
                <UIcon name="i-heroicons-hashtag" class="details-section-icon" />
                {{ t('bookmark_details.tags') }}
                </h6>

                <TransitionGroup tag="div" class="tags-wrapper" name="tags" @before-leave="tagsBeforeLeave">
                    <div :key="type + '_details-tags'">
                        <UBadge
                            class="details-tag-badge"
                            color="neutral"
                            variant="soft"
                        >
                            <IconBrew :icon="typeOfNewBookmarkIcon" :size="16"/>
                            <span class="ml-1">{{ getTypeOfBookmark }}</span>
                        </UBadge>
                    </div>

                    <div
                        v-for="subtype in subTypes"
                        :key="subtype + '_details-tags'"
                    >
                        <UBadge
                            class="details-tag-badge"
                            color="neutral"
                            variant="soft"
                        >
                            <IconBrew :icon="subtypeBookmarkIcon(subtype)" :size="16" />
                            <span class="ml-1 capitalize">{{ subtype }}</span>
                        </UBadge>
                    </div>

                    <div
                        v-if="webToShow.tags && webToShow.tags.length > 0"
                        v-for="(tag, index) in webToShow.tags"
                        :key="index + webToShow.objectId + '_details-tags'"
                    >
                        <UBadge
                            :id="tag"
                            class="tag-badge details-tag-badge"
                            color="neutral"
                            variant="soft"
                            @input="removeProhibitedTagChars, debounce(() => updateTags($event, tag, index), 250)"
                        >
                            <div class="tag-content"
                                @click="(e) => { e.target.contentEditable = true; e.target.focus() }"
                                @blur="(e) => e.target.contentEditable = false"
                            >
                                {{ tag }}
                            </div>

                            <UButton
                                @click="removeTag(tag)"
                                color="neutral"
                                variant="link"
                                icon="i-heroicons-x-mark"
                                square
                                size="3xs"
                                class="remove-tag-button"
                            />
                        </UBadge>
                    </div>
                    <!-- New tag input — sits in the same wrapping row as the badges.
                         The popup takes its width from the trigger, which is now a small
                         pill, so `content` holds a readable minimum. The trigger's icons
                         are normally absolute, cleared by `ps-7`/`pe-7` padding; that
                         padding shrinks with the pill in a tight row and the icons land
                         on the label, so lay them out in normal flow instead. -->
                    <USelectMenu
                        key="_details-add-tag"
                        class="details-add-tag-btn"
                        v-model="tagList"
                        v-model:search-term="tagQuery"
                        :items="tagItems"
                        value-key="label"
                        size="xs"
                        variant="soft"
                        color="neutral"
                        icon="i-heroicons-plus"
                        :ui="{
                            base: 'shrink-0 ps-2 pe-2',
                            leading: 'static p-0',
                            trailing: 'static p-0',
                            content: 'min-w-64 max-w-[min(20rem,90vw)]'
                        }"
                        :loading="tagsLoading"
                        :search-input="{ placeholder: $t('common.add_tag') }"
                        multiple
                        virtualize
                        ignore-filter
                        :create-item="{ when: 'always', position: 'top' }"
                        @create="addTag"
                        @update:open="onTagMenuOpen"
                    >
                        <!-- The trigger always reads "Add tag"; the selection is already
                             shown as badges next to it, so echoing it here is noise. -->
                        <template #default>{{ $t('common.add_tag') }}</template>
                        <template #item-trailing="{ item }">
                            <span class="text-xs opacity-50 tabular-nums">{{ item.count }}</span>
                        </template>
                    </USelectMenu>
                </TransitionGroup>
            </section>

            <hr v-if="webToShow.imageText" class="details-divider" />

            <!-- Extracted text -->
            <section v-if="webToShow.imageText" class="details-section">
                <div class="flex items-center justify-between">
                    <h6 class="details-section-title mb-0">
                        <UIcon name="i-heroicons-document-text" class="details-section-icon" />
                        {{ $t('bookmark.image_extracted_text') }}
                    </h6>

                    <UButton
                        @click="copyToClipboard(webToShow.imageText)"
                        color="neutral"
                        variant="ghost"
                        icon="i-heroicons-clipboard-document"
                        size="xs"
                    />
                </div>

                <p
                    class="details-extracted-text"
                    v-html="webToShow.imageText"
                />
            </section>

            <hr v-if="keywords && keywords.length > 0" class="details-divider" />

            <!-- Keywords -->
            <section v-if="keywords && keywords.length > 0" class="details-section">
                <div class="flex items-center justify-between">
                    <h6 class="details-section-title mb-0">
                        <UIcon name="i-heroicons-sparkles" class="details-section-icon" />
                        {{ t('bookmark_details.keywords') }}
                    </h6>
                    <UButton
                        v-if="keywords.length > 28"
                        @click="seeAllKeywords = !seeAllKeywords"
                        variant="ghost"
                        color="neutral"
                        class="opacity-60 hover:opacity-100"
                        size="xs"
                    >
                        {{ seeAllKeywords ? t('common.show_less') : t('common.show_more') }}
                    </UButton>
                </div>
                <div class="meta-wrapper">
                    <UBadge
                        v-for="(keyword, index) in keywords"
                        v-if="seeAllKeywords ? true : index < 30"
                        :key="keyword"
                        size="sm"
                        color="neutral"
                        variant="soft"
                        :style="{ opacity: seeAllKeywords ? 1 : Math.max(0.4, 1 - (index / 40)) }"
                    >
                        {{ keyword }}
                    </UBadge>
                </div>
            </section>
        </div>

        <!-- Resize handle -->
        <div
            v-if="!isMobile"
            class="site-options-resizer"
            @mousedown="startResize"
            @touchstart.prevent="startResize"
        >
            <span class="site-options-resizer-bar" />
        </div>
    </div>
</template>

  <script setup>
    import { storeToRefs } from 'pinia'
    import { useStore } from '~/stores/myStore'
    import { bookmarkCoverUrl } from '~/composables/useBookmarkImages'
    import { useI18n } from 'vue-i18n';
    import { watchDebounced } from '@vueuse/core'
    const { t } = useI18n();

    const store = useStore()

    const {
        createDebounce,
        saveUpdatedSite,
        showAlert,
        copyToClipboard
    } = store

    const {
        webToShow,
        showSideBarOptions,
        typeOptions,
        pageNotesFocused,
        bookmarkTypes,
        isMobile
    } = storeToRefs(store)

    /////// Resizable sidebar
    const SIDEBAR_WIDTH_KEY = 'websiteModalSidebarWidth'
    const MIN_SIDEBAR_WIDTH = 280
    const MAX_SIDEBAR_WIDTH = 640

    const sidebarRoot = ref(null)
    // null => let the CSS max-width rule size the panel (initial state).
    // A number => an explicit, user-chosen pixel width.
    const sidebarWidth = ref(null)
    const isResizing = ref(false)
    let resizeStartX = 0
    let resizeStartWidth = 0

    const clampWidth = (value) => {
        const max = Math.min(MAX_SIDEBAR_WIDTH, Math.round(window.innerWidth * 0.6))
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(max, value))
    }

    onMounted(() => {
        const stored = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10)
        if (!Number.isNaN(stored)) sidebarWidth.value = clampWidth(stored)
    })

    const startResize = (e) => {
        // Sync the reactive width to the panel's real rendered width *before*
        // dragging. On the first drag the panel may still be sized by the CSS
        // max-width rule rather than `sidebarWidth`, so anchoring the drag to a
        // stale `sidebarWidth` would make the panel jump to that value on the
        // first mousemove. Measuring here keeps the grab point 1:1 with the edge.
        if (sidebarRoot.value) sidebarWidth.value = sidebarRoot.value.offsetWidth

        isResizing.value = true
        resizeStartX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX
        resizeStartWidth = sidebarWidth.value

        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'

        window.addEventListener('mousemove', onResizeMove)
        window.addEventListener('mouseup', stopResize)
        window.addEventListener('touchmove', onResizeMove, { passive: false })
        window.addEventListener('touchend', stopResize)
    }

    const onResizeMove = (e) => {
        if (!isResizing.value) return
        if (e.cancelable) e.preventDefault()
        const currentX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX
        sidebarWidth.value = clampWidth(resizeStartWidth + (currentX - resizeStartX))
    }

    const stopResize = () => {
        if (!isResizing.value) return
        isResizing.value = false

        document.body.style.userSelect = ''
        document.body.style.cursor = ''

        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))

        window.removeEventListener('mousemove', onResizeMove)
        window.removeEventListener('mouseup', stopResize)
        window.removeEventListener('touchmove', onResizeMove)
        window.removeEventListener('touchend', stopResize)
    }

    onUnmounted(() => {
        window.removeEventListener('mousemove', onResizeMove)
        window.removeEventListener('mouseup', stopResize)
        window.removeEventListener('touchmove', onResizeMove)
        window.removeEventListener('touchend', stopResize)
    })

    const debounce = ref(createDebounce());
    const siteTitleLocal = ref('');
    const isEditingTitle = ref(false);
    const seeAllKeywords = ref(false);
    watch(() => webToShow.value?.siteTitle, (newTitle) => {
      if (!isEditingTitle.value) siteTitleLocal.value = newTitle ?? '';
    }, { immediate: true });

    const getImgUrl = computed(() => {
      if (webToShow.value?.file && webToShow.value?.file.url) {
        return typeof webToShow.value.file.url == 'function' ? webToShow.value.file.url() : webToShow.value.file.url;
      }
      return null
    })

    const resolveFileUrl = (file) => {
        if (!file) return null
        if (typeof file === 'string') return file
        if (file.url) return typeof file.url === 'function' ? file.url() : file.url
        return null
    }

    // Preview thumbnail shown at the top of the details panel. Mirrors the
    // image-resolution priority used by the bookmark card so the panel shows
    // the same artwork the user clicked on.
    const getPreviewImage = computed(() => {
        const site = webToShow.value
        if (!site) return null
        try {
            // images[0] is the cover and OGImage mirrors it; site.file is the
            // picture uploaded first and does not follow a reorder.
            if (site.type === 'image') return bookmarkCoverUrl(site)
            if (site.OGImage) return site.OGImage.replace('https://https://', 'https://')
            return resolveFileUrl(site.OGImageFile)
                || resolveFileUrl(site.siteScreenshot)
                || resolveFileUrl(site.file)
                || null
        } catch (error) {
            console.log('error resolving preview image: ', error)
            return null
        }
    })

    // Short, uppercase file-type chip overlaid on the preview (e.g. JPEG, PDF).
    const getFileTypeBadge = computed(() => {
        const site = webToShow.value
        if (!site) return null
        if (site.pdf) return 'PDF'
        // A recording's own extension, which is what it is stored as rather
        // than what it was recorded as — the server normalises on the way in.
        if (site.type === 'audio') {
            const name = String(site.fileName || site.fileUrl || '')
            const found = name.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)
            return found ? found[1].toUpperCase() : 'AUDIO'
        }
        const source = site.type === 'image' ? (resolveFileUrl(site.file) || site.url) : getPreviewImage.value
        if (!source) return null
        const match = String(source).split('?')[0].split('#')[0].match(/\.([a-z0-9]{2,5})$/i)
        if (!match) return null
        const ext = match[1].toLowerCase()
        return ext === 'jpg' ? 'JPEG' : ext.toUpperCase()
    })

    const tagList = computed({
      get: () => (webToShow.value?.tags ?? []).map(t => t?.label ?? t),
      set: (labels) => saveTags(labels.map(t => t?.label ?? t))
    });

    function saveTags(tags) {
      if (!webToShow.value) return
      const unique = [...new Set(tags.map(t => String(t).trim()).filter(Boolean))]
      const id = webToShow.value.objectId
      webToShow.value.tags = unique
      debounce.value(() => saveUpdatedSite(id, 'tags', unique), 250)
    }

    // The tag list comes from the backend a page at a time (ranked by use,
    // searched server-side), so a user with thousands of tags never loads them all.
    const { list: listTags } = useTags()
    const tagItems = ref([])
    const tagQuery = ref('')
    const tagPage = ref(0)
    const tagHasMore = ref(false)
    const tagsLoading = ref(false)

    async function loadTags(reset) {
      if (reset) { tagPage.value = 0; tagHasMore.value = false }
      tagsLoading.value = true
      try {
        const res = await listTags(tagQuery.value, tagPage.value)
        const items = res.tags.map(t => ({ label: t.name, count: t.count }))
        tagItems.value = reset ? items : [...tagItems.value, ...items]
        tagHasMore.value = res.hasMore
      } finally {
        tagsLoading.value = false
      }
    }

    watchDebounced(tagQuery, () => loadTags(true), { debounce: 200 })

    // The dropdown is portalled and its scroll container (the viewport around
    // the virtualizer) only exists while open, so catch its scroll events at the
    // document in the capture phase instead of hunting for the element.
    function onTagListScroll(event) {
      const el = event.target
      if (!(el instanceof HTMLElement) || !el.matches('[data-slot="viewport"]') || !el.querySelector('[data-reka-virtualizer]')) return
      if (!tagHasMore.value || tagsLoading.value) return
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 80) return
      tagPage.value++
      loadTags(false)
    }

    function onTagMenuOpen(open) {
      document.removeEventListener('scroll', onTagListScroll, true)
      if (!open) return
      if (!tagItems.value.length) loadTags(true)
      document.addEventListener('scroll', onTagListScroll, true)
    }

    onUnmounted(() => document.removeEventListener('scroll', onTagListScroll, true))

    function addTag(label) {
      const typed = String(label).replace(/[\r\n]/g, '').trim()
      if (!typed) return
      // Reuse the existing casing so "design" does not get created next to "Design".
      const existing = tagItems.value.find(t => t.label.toLowerCase() === typed.toLowerCase())
      const tag = existing?.label ?? typed
      // Meilisearch lags a few seconds behind a save; show the new tag now.
      if (!existing) tagItems.value.unshift({ label: tag, count: 1 })
      tagQuery.value = ''
      saveTags([...tagList.value, tag])
    }

    function removeTag(tag) {
      saveTags(tagList.value.filter(t => t !== tag))
    }

    const getTypeOfBookmark = computed(() => {
        switch (type.value) {
            case 'textNote':
                return t('bookmark_details.bookmark_types.note')
            case 'drawing':
                return t('bookmarks.types.drawing')
            case 'tweet':
                return t('bookmark_details.bookmark_types.tweet')
            case 'article':
                return t('bookmark_details.bookmark_types.article')
            case 'website':
                return t('bookmarks.types.website')
            case 'game':
                return t('bookmarks.types.game')
            case 'movie':
                return t('bookmarks.types.movie')
            case 'music':
                return t('bookmarks.types.music')
            case 'pdf':
                return t('bookmarks.types.pdf')
            case 'audio':
                return t('bookmarks.types.audio')
            default:
                return type.value ? type.value.charAt(0).toUpperCase() + type.value.slice(1) : type.value
        }
    });

    // A pdf bookmark carries subType ['pdf'] too, which would render the same
    // badge twice — drop any subtype that just repeats the main type.
    const subTypes = computed(() =>
        [...new Set(webToShow.value?.subType ?? [])]
            .filter(s => String(s).toLowerCase() !== String(type.value ?? '').toLowerCase())
    );

    const keywords = computed(() => {
        return webToShow.value.keywords;
    });

    const type = computed(() => {
        return webToShow.value.type
    })

    const getBaseURL = computed(() => {
        try {
            return webToShow.value.url.split('/')[2]
        } catch (e) {
            return webToShow.value.url
        }
    })

    const getDaysFromNow = computed(() => {
        // Get how many seconds, minutes, hours, days, months, OR years ago the article was saved
        const seconds = Math.floor((new Date() - new Date(webToShow.value.createdAt)) / 1000);
        let interval = Math.floor(seconds / 31536000);
        if (interval > 1) {
            return t('bookmark_details.time.years_ago', { count: interval });
        }
        interval = Math.floor(seconds / 2592000);
        if (interval > 1) {
            return t('bookmark_details.time.months_ago', { count: interval });
        }
        interval = Math.floor(seconds / 86400);
        if (interval > 1) {
            return t('bookmark_details.time.days_ago', { count: interval });
        }
        interval = Math.floor(seconds / 3600);
        if (interval > 1) {
            return t('bookmark_details.time.hours_ago', { count: interval });
        }
        interval = Math.floor(seconds / 60);
        if (interval > 1) {
            return t('bookmark_details.time.minutes_ago', { count: interval });
        }
        return t('bookmark_details.time.seconds_ago', { count: Math.floor(seconds) });
    })

    const typeOfNewBookmarkIcon = computed(() => {
        try {
            let webType = type.value;
            if(webType == 'website') return 'link'

            let icon = bookmarkTypes.value.find(type => type.value == webType);
            let iconToReturn;

            iconToReturn = icon.icon;
            return iconToReturn;
        } catch (error) {
            console.log("error: ", error);
        }
    })

    function updateTags(event, tag, index) {
        webToShow.value.tags[index] = event.target.innerText;
        saveUpdatedSite(webToShow.value.objectId, 'tags', webToShow.value.tags);
    }

    function copyColor(color) {
        navigator.clipboard.writeText(color.hex);
        showAlert({ message: t('bookmark_details.alerts.color_copied') })
    }

    function getContrastColor(hex) {
        try {
            // Remove the # if present
            hex = hex?.replace('#', '');

            // Convert hex to RGB
            const r = parseInt(hex?.substr(0, 2), 16);
            const g = parseInt(hex?.substr(2, 2), 16);
            const b = parseInt(hex?.substr(4, 2), 16);

            // Calculate relative luminance
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

            // Return black for bright colors, white for dark colors
            return luminance > 0.5 ? '#000000' : '#FFFFFF';
        } catch (error) {
            console.log("error: ", error);
            return '#000000'
        }
    }

    function getColorName(color) {
        let colorCategory = color.colorCategory != 'Unknown' ? ' ' + color.colorCategory : ''
        let colorName = color.colorName.includes(color.colorCategory) ? color.colorName : color.colorName + colorCategory
        return colorName
    }

    function tagsBeforeLeave(el) {
        // Get the bounding rectangle of the element
        const left = el.offsetLeft;
        const top = el.offsetTop;
        console.log(left, top);
        // Set the style to position the element absolutely at its current position
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
    }

    function subtypeBookmarkIcon(subtype) {
        try {
            switch (true) {
                case subtype.includes('article'):
                    return 'news';
                case subtype.includes('tweet'):
                    return 'twitter';
                case subtype.includes('news'):
                    return 'ribbon';
                default:
                    return 'i-heroicons-bookmark';
                    // return 'bookmark';
                    break;
            }
        } catch (error) {
            console.log("error: ", error);
            return 'documentVideo'
        }
    }

    function removeProhibitedTagChars(e) {
        e.target.innerText = e.target.innerText.replace(/(\r\n|\n|\r)/gm, "");
        e.target.innerText = e.target.innerText.replace(/\n/, "");
    }

    async function downloadImage(url) {
        try {
            const image = await fetch(url)
            const imageBlog = await image.blob()
            const imageURL = URL.createObjectURL(imageBlog)

            const link = document.createElement('a')
            link.href = imageURL
            console.log('url: ', url)
            let fileName = url.split('/').pop().split('#')[0].split('?')[0];
            link.download = fileName
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)

            showAlert({
                message: t('bookmark_details.alerts.image_downloaded'),
                type: 'success'
            })
        } catch (error) {
            console.log(error)
            showAlert({
                message: t('bookmark_details.alerts.image_download_error'),
                type: 'error'
            })
        }
    }

    // Add this utility function
    function arraysAreEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) return false;
        return arr1.every((item, index) => item === arr2[index]);
    }

  </script>
