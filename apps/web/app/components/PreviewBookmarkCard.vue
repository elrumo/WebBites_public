<template>
    <div v-if="!node" class="bookmark-preview-wrapper">
        <div class="relative w-full h-full flex justify-center">
            <Transition
                name="blur-in"
                mode="out-in"
            >
                <!-- Same shell as .bookmark-card-base so the placeholder sits
                     in the grid like any other card. -->
                <div
                    v-if="!previewData && !isImage"
                    class="flex flex-col w-full h-full mx-auto rounded-xl overflow-hidden bg-white dark:bg-neutral-900 shadow-md shadow-neutral-200/50 dark:shadow-black/20 ring-1 ring-neutral-200/30 dark:ring-neutral-700/30"
                >
                    <USkeleton class="h-42 sm:h-22 grow w-full rounded-none"/>
                    <div class="flex flex-col gap-1.5 py-2.5 px-3">
                        <USkeleton class="h-4 w-full sm:max-w-64"/>
                        <USkeleton class="h-2 max-w-48"/>
                    </div>
                </div>

                <div
                    v-else-if="previewData"
                    @click="goTo($event)"
                    :class="{
                      'border-blue-500 border-2': isFirstTime,
                      'bookmark-card preview-card mx-auto': true
                    }"
                >
                    <div class="card-header">
                        <img
                            class="w-full h-40 sm:h-48 object-cover"
                            :src="previewImage"
                            @error="onImageError($event)"
                        />
                    </div>

                    <div v-if="!isImage" class="card-content">
                        <h4 class="font-semibold line-clamp-2">
                            {{ previewTitle }}
                        </h4>
                        <p v-if="previewData.description" class="font-light line-clamp-2">
                            {{ previewData.description }}
                        </p>
                    </div>
                </div>
            </Transition>
        </div>
    </div>

    <node-view-wrapper
        v-else
        class="bookmark-preview-wrapper bookmark-preview-node relative"
        :class="!previewData && !isImage ? 'is-skeleton' : ''"
    >
        <UButton
            icon="i-heroicons-x-mark"
            square
            color="red"
            size="3xs"
            @click="deletePreview"
            class="delete-preview-btn"
        />

        <div :class="'relative w-full flex items-center justify-between'">
            <Transition
                name="blur-in"
                mode="out-in"
            >
                <div
                    v-if="!previewData && !isImage"
                    class="bookmark-card preview-card aspect-video w-full !overflow-hidden mt-1 mx-auto"
                >
                    <div class="p-0 relative w-full flex ">
                        <USkeleton class="h-[7rem] sm:h-34 w-full rounded-lg rounded-b-none"/>
                    </div>
                </div>

                <div
                    v-else-if="previewData"
                    @click="goTo($event)"
                    :class="{ 'border-blue-500 border-2': isFirstTime, 'bookmark-card': true, 'preview-card': true }"
                >
                    <div class="card-header">
                        <img
                            class="w-full h-40 sm:h-48 object-cover"
                            :src="previewImage"
                            @error="onImageError($event)"
                        />
                    </div>

                    <div v-if="!isImage" class="card-content">
                        <h4 class="font-semibold line-clamp-2">
                            {{ previewTitle }}
                        </h4>
                        <p v-if="previewData.description" class="font-light line-clamp-2">
                            {{ previewData.description }}
                        </p>
                    </div>
                </div>
            </Transition>
        </div>
    </node-view-wrapper>
</template>

<script>
import { mapActions, mapWritableState } from 'pinia'
import { useStore } from '~/stores/myStore'
import { NodeViewWrapper } from '@tiptap/vue-3'

export default {
    name: 'PreviewBookmarkCard',

    components: {
        NodeViewWrapper
    },

    props: {
        // Props for standalone usage
        sitePreview: {
            type: Object,
            default: null
        },
        url: {
            type: String,
            default: null
        },
        // Props for Tiptap node usage
        node: {
            type: Object,
            default: null
        },
        updateAttributes: {
            type: Function,
            default: null
        },
        editor: {
            type: Object,
            default: null
        },
        deleteNode: {
            type: Function,
            default: null
        }
    },

    computed: {
        ...mapWritableState(useStore, [
            'isFirstTime'
        ]),

        // Compute preview data from either source
        previewData() {
            return this.node?.attrs?.preview || this.sitePreview
        },

        // Compute current URL from either source
        currentUrl() {
            return this.node?.attrs?.url || this.url
        },

        /**
         * The address, as an address.
         *
         * In the composer `url` is whatever the editor holds, which is HTML —
         * `<p class="editor-paragraph">https://…</p>`. Everything that wants to
         * parse, open or name the link needs the link out of it first.
         */
        cleanUrl() {
            const raw = String(this.previewData?.url || this.currentUrl || '')
                .replace(/<[^>]*>/g, '')
                .trim();
            const match = raw.match(/https?:\/\/[^\s"'<>]+/);
            return match ? match[0] : raw;
        },

        isImage() {
            const imageUrlPattern = /\.(jpeg|jpg|gif|png|svg|webp|bmp|tiff)$/i;
            return imageUrlPattern.test(this.cleanUrl);
        },

        /**
         * What the card is called.
         *
         * Plenty of sites refuse a server-side fetch, and the card used to show
         * their blank title as a blank line under a gradient. The host is the
         * one thing a link always has, so it stands in.
         */
        previewTitle() {
            const title = this.previewData?.title?.trim();
            if (title) return title;
            try {
                return new URL(this.cleanUrl).hostname.replace(/^www\./, '');
            } catch {
                return this.cleanUrl;
            }
        },

        previewImage() {
            if (this.isImage) return this.cleanUrl;
            return this.previewData?.imageUrl
                || this.randomGradient(this.cleanUrl || this.previewTitle || 'preview-bookmark');
        }
    },

    methods: {
        ...mapActions(useStore, [
            'randomGradient'
        ]),

        onImageError(event) {
            console.log("event error image: ", event);
        },

        goTo(event) {
            const url = this.cleanUrl;
            if (!url || event.target.closest('.iconbrew-small')) return;
            window.open(url, '_blank');
        },

        deletePreview() {
            if (this.editor && this.deleteNode) {
                // Use the deleteNode function provided by the node view
                this.deleteNode();
            }
        }
    }
}
</script>

<style>
</style>
