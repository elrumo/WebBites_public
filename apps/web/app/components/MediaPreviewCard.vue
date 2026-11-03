<template>
    <div :class="`${typeOfMedia}-preview-card ${ skeleton ? 'skeleton' : ''}`">
        <div :class="`${typeOfMedia}-preview-body relative`">
            
            <!-- <div v-if="showDelete && !skeleton" class="absolute -top-5 left-1/2 translate-x--1/2 opacity-50 hover:opacity-100">
                <div class="reactions-content">
                    <UButton @click="removeBookmark" square class="rounded-full" icon="i-heroicons-x-mark" />
                </div>
            </div> -->

            <img
                v-if="!skeleton"
                :src="poster"
                :alt="$t(`cards.media_preview.${typeOfMedia}_poster_alt`)"
                :class="`${typeOfMedia}-preview-image shadow-lg`"
            >
            <USkeleton v-else class="h-24 border dark:border-gray-700 max-w-44 shadow-md"/>

            <div :class="`${typeOfMedia}-preview-content`">

                <small v-if="!skeleton" class="opacity-60">
                    {{ date == 'Invalid Date' ? $t('cards.media_preview.date_unavailable') : date }}
                </small>
                
                <USkeleton v-else class="h-4 w-20 border dark:border-gray-700 max-w-44 shadow-md"/>

                <h6 v-if="!skeleton" :class="`${typeOfMedia}-preview-title`">
                    {{ title }}
                </h6>
                
                <USkeleton v-else class="h-5 w-44 border dark:border-gray-700 max-w-44 shadow-md mt-2 mb-2"/>
            
                <p v-if="!skeleton" :class="`${typeOfMedia}-preview-overview`">
                    {{ summary }}
                </p>
                
                <USkeleton
                    v-for="n in random(1, 3)"
                    v-else
                    :class="`h-3 w-${random(1, 3)}/4 border dark:border-gray-700 max-w-44 shadow-md mt-1`"
                />

                <div v-if="typeOfMedia == 'game'" class="pb-2">
                    <div v-if="typeOfMedia == 'game' && mediaBookmark.platforms && !skeleton" class="platforms-list">
                        <UBadge
                            size="xs"
                            variant="solid"
                            class="font-light opacity-70"
                            v-for="platform in mediaBookmark.platforms" 
                        >
                            {{ platform.name }}
                        </UBadge>
                    </div>

                    <div v-else-if="typeOfMedia == 'game' && skeleton" class="platforms-list">
                        <span v-for="n in random(1, 4)"></span>
                    </div>
                </div>
            </div>
        </div>


    </div>
</template>

<script>
import { mapActions, mapWritableState } from 'pinia';
import { useStore } from '~/stores/myStore';

export default {
    name: 'MediaPreviewCard',
    
    components: {
    },

    props:{
        typeOfMedia: String,
        showDelete: {
            type: Boolean,
            default: false
        },
        mediaBookmark: {
            type: Object,
            default: {}
        },
        skeleton: {
            type: Boolean,
            default: false
        }
    },

    methods: {
        ...mapActions(useStore, [
            'toLocaleDate'
        ]),

        removeBookmark() {
            this.$emit('removeBookmark');
        },

        random(min, max) {
            min = Math.ceil(min);
            max = Math.floor(max);
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }

    },

    computed: {

        poster(){
            switch (this.typeOfMedia) {
                case 'movie': return this.mediaBookmark.poster_path ?
                                'https://image.tmdb.org/t/p/w500' + this.mediaBookmark.poster_path :
                                'https://placehold.co/100x133?text=Image';
                case 'game':
                    return this.mediaBookmark.cover ?
                                this.mediaBookmark.cover.url.replaceAll('//', 'https://').replaceAll('t_thumb', 't_cover_big') :
                                'https://placehold.co/100x133?text=Image';
            }
        },

        title(){
            switch (this.typeOfMedia) {
                case 'movie': return this.mediaBookmark.title ? this.mediaBookmark.title : "";
                case 'game': return this.mediaBookmark.name ? this.mediaBookmark.name : "";
                default: return '';
            }
        },

        date(){
            switch (this.typeOfMedia) {
                case 'movie': return this.toLocaleDate(this.mediaBookmark.release_date);
                case 'game': return this.toLocaleDate(this.mediaBookmark.first_release_date, { isUnixTime: true });
                default: return '';
            }
        },

        summary(){
            switch (this.typeOfMedia) {
                case 'movie': return this.mediaBookmark.overview ? this.mediaBookmark.overview : '';
                case 'game': return this.mediaBookmark.summary ? this.mediaBookmark.summary : '';
                default: return '';
            }
        }
    }
}
</script>
