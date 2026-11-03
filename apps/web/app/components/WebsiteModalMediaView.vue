<template>
    <div class="type-movie-content">
        <div class="movie-backdrop">
            <img :src="poster.backdrop" :alt="t('website_modal_media_view.backdrop_alt', { title })">
        </div>

            <div class="movie-wrapper">
            <div class="movie-header">
                <div class="movie-poster">
                    <div v-tilt="tiltOptionsLogo">
                        <img
                            :src="poster.poster"
                            :alt="title"
                            @click="isPosterModalOpen = true"
                            style="cursor: pointer;"
                        >
                    </div>

                    <UModal v-model:open="isPosterModalOpen">
  <template #content>
                        <img
                            :src="poster.poster"
                            :alt="title"
                            class="w-full rounded-lg"
                        >
                    
  </template>
</UModal>
                </div>

                <div class="movie-body">
                    <div class="movie-info">
                        <div class="movie-options">
                            <CirclePercentage v-if="getRating" :percentage="getRating"/>

                            <UButton
                                v-if="type == 'movie'"
                                variant="solid"
                                color="neutral"
                                :to="'https://www.imdb.com/title/' + webToShow.mediaTypeObject.imdb_id"
                                target="_blank"
                            >
                              <UIcon name="i-heroicons-arrow-top-right-on-square"/>
                              <b>
                                IMBD
                              </b>
                            </UButton>

                            <UButton
                                variant="solid"
                                :to="webToShow.url"
                                target="_blank"
                                color="neutral"
                                icon=""
                            >
                            <UIcon name="i-heroicons-arrow-top-right-on-square"/>
                                <b>
                                    {{type == 'movie' ? 'TMDB' : 'IGDB'}}
                                </b>
                            </UButton>
                        </div>

                        <div class="movie-title">
                            <h4 class="mt-0">
                                {{ title }}
                            </h4>
                        </div>

                        <p
                            v-if="summary"
                            class="movie-overview"
                        >
                            {{ summary }}
                        </p>

                        <div v-if="type == 'game' && getPlatforms" class="platforms-list">
                            <div v-for="platform in getPlatforms" color="whui" class="platform-tag">
                                <a :href="platform.url.replace('https:', '')" target="_blank">
                                    {{ platform.name }}
                                </a>
                            </div>
                        </div>
                    </div>

                    <div class="movie-details">
                        <!-- Director -->
                        <div v-if="getMovieDirector">
                            <h6 class="m-0">
                                {{ t('bookmark_details.media.director') }}
                            </h6>
                            <span>
                                {{ getMovieDirector }}
                            </span>
                        </div>

                        <!-- Date -->
                        <div v-if="date">
                            <h6 class="m-0">
                                {{ t('bookmark_details.media.release_date') }}
                            </h6>
                            <p class="movie-genres">
                                {{ date }}
                            </p>
                        </div>

                        <!-- Genres -->
                        <div v-if="genres">
                            <h6 class="m-0">
                                {{ t('bookmark_details.media.genres') }}
                            </h6>
                            <div class="movie-genres">
                                <div class="platform-tag" v-for="genre in genres">
                                    <a :href="genre.url" target="_blank">
                                        {{ genre.name }}
                                    </a>
                                </div>
                            </div>
                        </div>

                        <!-- Developers -->
                        <div v-if="getDeveloper">
                            <h6 class="m-0">
                                {{ t('bookmark_details.media.developer') }}
                            </h6>
                            <div class="movie-genres">
                                <img v-if="getDeveloper.logo" class="game-company-logo" :src="getDeveloper.logo.url" alt="">
                                <a :href="getDeveloper.url" target="_blank">
                                    {{ getDeveloper.name }}
                                </a>
                            </div>
                        </div>

                        <div v-if="getPublisher">
                            <h6 class="m-0">
                                {{ t('bookmark_details.media.publisher') }}
                            </h6>
                            <div class="movie-genres">
                                <img v-if="getPublisher.logo" class="game-company-logo" :src="getPublisher.logo.url" alt="">
                                <a :href="getPublisher.url" target="_blank">
                                    {{ getPublisher.name }}
                                </a>
                            </div>
                        </div>

                        <!-- Cast -->
                        <div v-if="mediaBookmark.credits && mediaBookmark.credits.cast" class="movie-credits-section">
                            <div class="flex justify-between items-center">
                                <h6 class="m-0">
                                  {{ t('bookmark_details.media.cast') }}
                                </h6>
                                <UButton
                                    v-if="hasMoreCast"
                                    size="xs"
                                    variant="ghost"
                                    class="text-white opacity-70 hover:opacity-100"
                                    @click="showAllCast = !showAllCast"
                                >
                                    {{ showAllCast ? $t('common.show_less') : $t('bookmark_details.media.show_more', { count: remainingCastProfiles.length }) }}
                                </UButton>
                            </div>
                            <div class="movie-credits">
                                <MovieCastProfile
                                    v-for="castProfile in limitedCastProfiles"
                                    :castProfile="castProfile"
                                />
                            </div>
                            <TransitionExpand v-if="hasMoreCast">
                                <div v-if="showAllCast" class="movie-credits">
                                    <MovieCastProfile
                                        v-for="castProfile in remainingCastProfiles"
                                        :castProfile="castProfile"
                                    />
                                </div>
                            </TransitionExpand>
                        </div>

                        <!-- Crew -->
                        <div v-if="mediaBookmark.credits && mediaBookmark.credits.crew" class="movie-credits-section">
                            <div class="flex justify-between items-center">
                                <h6 class="m-0">
                                  {{ t('bookmark_details.media.crew') }}
                                </h6>
                                <UButton
                                    v-if="hasMoreCrew"
                                    size="xs"
                                    variant="ghost"
                                    class="text-white opacity-70 hover:opacity-100"
                                    @click="showAllCrew = !showAllCrew"
                                >
                                    {{ showAllCrew ? $t('common.show_less') : $t('bookmark_details.media.show_more', { count: remainingCrewProfiles.length }) }}
                                </UButton>
                            </div>
                            <div class="movie-credits">
                                <MovieCastProfile
                                    v-for="castProfile in limitedCrewProfiles"
                                    :castProfile="castProfile"
                                />
                            </div>
                            <TransitionExpand v-if="hasMoreCrew">
                                <div v-if="showAllCrew" class="movie-credits">
                                    <MovieCastProfile
                                        v-for="castProfile in remainingCrewProfiles"
                                        :castProfile="castProfile"
                                    />
                                </div>
                            </TransitionExpand>
                        </div>
                    </div>

                    <!-- Game collections -->
                    <div v-if="collections" class="movie-images">
                        <div v-for="collection in collections">
                            <div class="game-collection">
                                <p class="m-0">
                                    <b> {{ collection.name }}</b>
                                </p>

                                <div class="game-collection-games">
                                    <div
                                        v-for="game in collection.games"
                                        class="game-collection-card"
                                    >
                                        <a :href="game.url ? game.url : ''" target="_blank">
                                            <div class="game-collection-card-image">
                                                <small v-if="game.first_release_date">
                                                    {{ getDate(game.first_release_date, { isUnixTime: true}) }}
                                                </small>
                                                <!-- :src="game.cover && game.cover.url ? game.cover.url : 'https://placehold.co/100x133?text=Image'" -->
                                                <img
                                                    :src="game.cover && game.cover.url ? game.cover.url : 'https://placehold.co/100x133?text=Image'"
                                                    :alt="t('website_modal_media_view.game_cover_alt', { name: game.name })"
                                                >
                                            </div>
                                            <p>{{ game.name }}</p>
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Game videos -->
                    <div v-if="videos" class="movie-images">
                      <h6 class="">
                        {{ t('bookmark_details.media.videos') }}
                      </h6>

                      <div class="flex overflow-x-auto gap-4 pr-4 pb-4 w-[50vw] -mt-2 h-[300px]">
                        <div v-for="video in videos" class="flex-none w-full h-full max-w-lg aspect-video shadow-lg">
                          <iframe
                              v-if="showVideos"
                              class="aspect-video h-full rounded-lg"
                              :src="`https://www.youtube.com/embed/${video.video_id}`"
                              frameborder="0"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowfullscreen
                          ></iframe>
                        </div>
                      </div>
                    </div>

                    <div v-if="images" class="movie-images">
                        <h6 class="m-0 -mb-2">
                          {{ t('bookmark_details.media.screenshots') }}
                        </h6>
                        <div
                            v-if="showVideos"
                            v-for="(image, index) in images"
                            @click="openImageModal(index)"
                            style="cursor: pointer;"
                        >
                            <img class="movie-image-backdrops" :src="image.url" alt="">
                        </div>
                    </div>

                    <UModal v-model:open="isImageModalOpen">
                        <!-- <UCard>
                            <template #header>
                                <div class="flex justify-between items-center">
                                    <h3 class="text-xl font-semibold">Gallery</h3>
                                    <UButton
                                        color="neutral"
                                        variant="ghost"
                                        icon="i-heroicons-x-mark-20-solid"
                                        @click="isImageModalOpen = false"
                                    />
                                </div>
                            </template> -->

                            <UCarousel
                                v-if="images"
                                v-model="selectedImageIndex"
                                v-slot="{ item }"
                                :ui="{ item: 'basis-full' }"
                                :items="images.map(img => (img.url))"
                                class="rounded-lg overflow-hidden"
                                arrows
                                indicators
                            >
                                <img :src="item" class="w-full" draggable="false">
                            </UCarousel>
                        <!-- </UCard> -->
                    </UModal>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useI18n } from 'vue-i18n';
import { vTilt } from '~/utils/vanillaTilt'
const { t } = useI18n();

const store = useStore()
const { webToShow, showWebsiteModal } = storeToRefs(store)
const { showAlert, toLocaleDate, getDate } = store

const props = defineProps({
  website: {
    type: Object,
    default: () => ({})
  },
  type: {
    type: String,
    default: 'movie'
  }
})

const tiltOptionsLogo = {
  max: 10,
  speed: 400,
  glare: false
}

const showVideos = ref(false)
const isImageModalOpen = ref(false)
const selectedImageIndex = ref(0)
const isPosterModalOpen = ref(false)
const showAllCast = ref(false)
const showAllCrew = ref(false)

onMounted(() => {
  setTimeout(() => {
    showVideos.value = true
  }, 400)
})

onBeforeUnmount(()=>{
  console.log("showWebsiteModal: ", showWebsiteModal.value)
  showVideos.value = false;
})

const openImageModal = (index) => {
  selectedImageIndex.value = index
  isImageModalOpen.value = true
}

// Computed properties
const limitedCastProfiles = computed(() => {
  if (!webToShow.value?.mediaTypeObject?.credits?.cast) return []
  return webToShow.value.mediaTypeObject.credits.cast.slice(0, 5)
})

const remainingCastProfiles = computed(() => {
  if (!webToShow.value?.mediaTypeObject?.credits?.cast) return []
  return webToShow.value.mediaTypeObject.credits.cast.slice(5)
})

const hasMoreCast = computed(() => remainingCastProfiles.value.length > 0)

const limitedCrewProfiles = computed(() => {
  if (!webToShow.value?.mediaTypeObject?.credits?.crew) return []
  return webToShow.value.mediaTypeObject.credits.crew.slice(0, 5)
})

const remainingCrewProfiles = computed(() => {
  if (!webToShow.value?.mediaTypeObject?.credits?.crew) return []
  return webToShow.value.mediaTypeObject.credits.crew.slice(5)
})

const hasMoreCrew = computed(() => remainingCrewProfiles.value.length > 0)

const mediaBookmark = computed(() => webToShow.value.mediaTypeObject)

const getMovieDirector = computed(() => {
  try {
    const crew = webToShow.value.mediaTypeObject.credits.crew
    const director = crew.find(crew => crew.job === 'Director')
    return director.name
  } catch (error) {
    return false
  }
})

const title = computed(() => {
  switch (props.type) {
    case 'movie': return mediaBookmark.value.title
    case 'game': return mediaBookmark.value.name
    default: return false
  }
})

const poster = computed(() => {
  let posterObj = {}
  switch (props.type) {
    case 'movie':
      posterObj = {
        backdrop: mediaBookmark.value.backdrop_path ?
          'https://image.tmdb.org/t/p/original' + mediaBookmark.value.backdrop_path :
          'https://placehold.co/100x133?text=Image',
        poster: mediaBookmark.value.poster_path ?
          'https://image.tmdb.org/t/p/original' + mediaBookmark.value.poster_path :
          'https://placehold.co/100x133?text=Image',
      }
      return posterObj
    case 'game':
      posterObj = {
        backdrop: mediaBookmark.value.cover ? mediaBookmark.value.cover.url : 'https://placehold.co/100x133?text=Image',
        poster: mediaBookmark.value.cover ? mediaBookmark.value.cover.url : 'https://placehold.co/100x133?text=Image',
      }
      return posterObj
  }
})

const getRating = computed(() => {
  switch (props.type) {
    case 'movie':
      if (!mediaBookmark.value.vote_average) return false
      return mediaBookmark.value.vote_average
    case 'game':
      if (!mediaBookmark.value.aggregated_rating) return false
      return Math.floor(mediaBookmark.value.aggregated_rating) / 10
    default:
      return false
  }
})

const date = computed(() => {
  switch (props.type) {
    case 'movie':
      if (!mediaBookmark.value.release_date) return false
      return getDate(mediaBookmark.value.release_date)
    case 'game':
      if (!mediaBookmark.value.first_release_date) return false
      return getDate(mediaBookmark.value.first_release_date, { isUnixTime: true })
    default:
      return false
  }
})

const summary = computed(() => {
  switch (props.type) {
    case 'movie':
      return mediaBookmark.value.overview ? mediaBookmark.value.overview : false
    case 'game':
      return mediaBookmark.value.summary ? mediaBookmark.value.summary : false
    default:
      return false
  }
})

const videos = computed(() => {
  if (props.type !== 'game') return false
  return mediaBookmark.value.videos || false
})

const images = computed(() => {
  switch (props.type) {
    case 'movie':
      if (!mediaBookmark.value.movieImages) return false
      return mediaBookmark.value.movieImages.backdrops.map(image => ({
        ...image,
        url: 'https://image.tmdb.org/t/p/original' + image.file_path
      }))
    case 'game':
      return mediaBookmark.value.screenshots ? mediaBookmark.value.screenshots : false
    default:
      return false
  }
})

const genres = computed(() => {
  switch (props.type) {
    case 'movie':
      return mediaBookmark.value.genres ? mediaBookmark.value.genres : false
    case 'game':
      return mediaBookmark.value.genres ? mediaBookmark.value.genres : false
    default:
      return false
  }
})

const getDeveloper = computed(() => {
  try {
    if (props.type === 'game' && mediaBookmark.value.involved_companies) {
      return mediaBookmark.value.involved_companies.find(company => company.developer)?.company || false
    }
    return false
  } catch (error) {
    return false
  }
})

const getPublisher = computed(() => {
  try {
    if (props.type === 'game' && mediaBookmark.value.involved_companies) {
      return mediaBookmark.value.involved_companies.find(company => company.publisher)?.company || false
    }
    return false
  } catch (error) {
    return false
  }
})

const getPlatforms = computed(() => {
  return mediaBookmark.value.platforms ? mediaBookmark.value.platforms : []
})

const collections = computed(() => {
  if (props.type === 'movie' || props.type === 'book') return false
  if (!mediaBookmark.value.collections) return false
  return mediaBookmark.value.collections
})
</script>
