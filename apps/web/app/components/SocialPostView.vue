<template>
  <div class="social-post-view @container">
    <div
      class="social-post"
      :class="wide ? 'max-w-[1080px]' : 'max-w-[620px]'"
    >
      <div class="flex items-center justify-between px-2 pb-3">
        <span class="social-accent inline-flex items-center gap-2 text-sm font-semibold" :style="accentVars">
          <img v-if="webToShow.siteLogo" :src="webToShow.siteLogo" alt="" class="size-4 rounded-[3px]">
          {{ platformName }}
        </span>
        <span class="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <UIcon name="i-heroicons-bookmark-solid" class="size-3.5" />
          {{ $t('website_modal.social.saved_post') }}
        </span>
      </div>

      <article
        class="social-card overflow-hidden rounded-[28px] border border-black/5 bg-white p-2 shadow-[0_12px_24px_rgb(0_0_0/0.05)] dark:border-white/10 dark:bg-neutral-900"
        :class="wide ? 'flex flex-col @3xl:flex-row @3xl:items-center' : 'flex flex-col'"
      >
        <!-- Media leads on the platforms that are pictures first; the DOM keeps
             the caption ahead of it so reading order follows the post. -->
        <div
          v-if="post.media.length"
          class="social-stage"
          :class="[leadsWithMedia ? 'order-first' : 'order-last', wide && '@3xl:flex-1 @3xl:basis-0 @3xl:min-w-0']"
        >
          <div ref="emblaRef" class="overflow-hidden">
            <div class="social-track">
              <div v-for="(item, i) in post.media" :key="item.url" class="social-slide">
                <img class="social-backdrop" :src="item.src" alt="" aria-hidden="true" loading="lazy">
                <button
                  type="button"
                  class="social-slide-button"
                  :aria-label="$t('website_modal.social.enlarge')"
                  @click="enlarge(i)"
                >
                  <img
                    class="social-picture"
                    :src="item.src"
                    alt=""
                    draggable="false"
                    referrerpolicy="no-referrer"
                    :loading="i === 0 ? 'eager' : 'lazy'"
                  >
                </button>
                <span v-if="item.kind === 'video'" class="social-badge">
                  <UIcon name="i-heroicons-film" class="size-3.5" />
                  {{ $t('website_modal.social.video_preview') }}
                </span>
              </div>
            </div>
          </div>

          <template v-if="post.media.length > 1">
            <button
              type="button"
              class="social-arrow social-arrow--prev"
              :disabled="current === 0"
              :aria-label="$t('website_modal.social.previous')"
              @click="emblaApi?.scrollPrev()"
            ><UIcon name="i-heroicons-chevron-left" class="size-5" /></button>
            <button
              type="button"
              class="social-arrow social-arrow--next"
              :disabled="current === post.media.length - 1"
              :aria-label="$t('website_modal.social.next')"
              @click="emblaApi?.scrollNext()"
            ><UIcon name="i-heroicons-chevron-right" class="size-5" /></button>

            <div class="social-dots">
              <span class="social-count">{{ current + 1 }} / {{ post.media.length }}</span>
              <button
                v-for="(_, i) in post.media"
                :key="i"
                type="button"
                class="social-dot"
                :class="{ 'is-current': i === current }"
                :aria-label="$t('bookmarks.image_n_of_m', { n: i + 1, m: post.media.length })"
                @click="emblaApi?.scrollTo(i)"
              />
            </div>
          </template>
        </div>

        <div class="story" :class="wide && '@3xl:flex-1 @3xl:basis-0 @3xl:min-w-0'">
          <header class="flex items-center gap-3">
            <img
              v-if="post.authorAvatar"
              :src="post.authorAvatar"
              alt=""
              referrerpolicy="no-referrer"
              class="size-11 shrink-0 rounded-full bg-neutral-200 object-cover dark:bg-neutral-800"
            >
            <span
              v-else
              class="social-accent social-monogram grid size-11 shrink-0 place-items-center rounded-full text-lg font-semibold"
              :style="accentVars"
              aria-hidden="true"
            >{{ monogram }}</span>

            <div class="min-w-0">
              <p class="text-base font-semibold leading-tight">{{ displayAuthor }}</p>
              <p class="mt-0.5 truncate text-[13px] text-neutral-500 dark:text-neutral-400">
                <template v-if="handle && handle !== post.author">{{ handle }}</template>
                <template v-if="handle && handle !== post.author && dateLabel"> · </template>
                <template v-if="dateLabel">{{ dateLabel }}</template>
              </p>
            </div>
          </header>

          <div class="social-rule social-accent" :style="accentVars" />

          <h2 v-if="showsTitle && post.title" class="text-2xl font-semibold leading-snug">{{ post.title }}</h2>

          <p v-if="runs.length" class="social-caption">
            <template v-for="(run, i) in runs" :key="i">
              <a
                v-if="run.url"
                :href="run.url"
                target="_blank"
                rel="noopener noreferrer"
                class="social-accent hover:underline"
                :style="accentVars"
              >{{ run.text }}</a>
              <span v-else-if="run.kind !== 'plain'" class="social-accent" :style="accentVars">{{ run.text }}</span>
              <template v-else>{{ run.text }}</template>
            </template>
          </p>

          <a
            v-if="openUrl"
            :href="openUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="social-accent social-open flex min-h-11 items-center justify-between rounded-xl px-4 text-sm font-semibold"
            :style="accentVars"
          >
            {{ $t('website_modal.social.view_on', { platform: platformName }) }}
            <UIcon name="i-heroicons-arrow-up-right" class="size-4" />
          </a>
        </div>

      </article>
    </div>

    <vue-easy-lightbox
      :visible="lightboxOpen"
      :imgs="post.media.map(m => m.src)"
      :index="lightboxIndex"
      :move-disabled="false"
      @hide="lightboxOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import emblaCarouselVue from 'embla-carousel-vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { webToShow } = storeToRefs(useStore())
const { t } = useI18n()

// The modal keeps one instance while you page between bites, so everything is
// derived from `webToShow` and the carousel is re-initialised when it changes.
const post = computed(() => socialPostOf(webToShow.value) ?? { platform: 'web', media: [] })
const runs = computed(() => socialTextRuns(post.value.text, post.value.platform))

const PLATFORMS = {
  twitter: { name: 'X', accent: ['#111', '#f5f5f5'] },
  threads: { name: 'Threads', accent: ['#111', '#f5f5f5'] },
  instagram: { name: 'Instagram', accent: ['#c9234f', '#f0527f'] },
  bluesky: { name: 'Bluesky', accent: ['#0a6fd6', '#4aa3ff'] },
  mastodon: { name: 'Mastodon', accent: ['#5b57c9', '#9a97f5'] },
  reddit: { name: 'Reddit', accent: ['#d93a00', '#ff6a3d'] },
  tiktok: { name: 'TikTok', accent: ['#d6204f', '#ff4d7a'] },
  youtube: { name: 'YouTube', accent: ['#d01216', '#ff4e51'] },
  pinterest: { name: 'Pinterest', accent: ['#c8102e', '#f0415d'] },
}
const platformInfo = computed(() => PLATFORMS[post.value.platform] ?? { name: t('social_post_view.fallback_platform'), accent: ['#2563eb', '#60a5fa'] })
const platformName = computed(() => platformInfo.value.name)
const accentVars = computed(() => ({ '--accent-l': platformInfo.value.accent[0], '--accent-d': platformInfo.value.accent[1] }))

// A Reddit submission, a YouTube video and a Pin have a headline of their own.
// For a tweet or a Reel the backend composes "@handle: first line", which would
// print the caption twice.
const showsTitle = computed(() => ['reddit', 'youtube', 'pinterest'].includes(post.value.platform))
const leadsWithMedia = computed(() => ['instagram', 'tiktok', 'pinterest'].includes(post.value.platform) && post.value.media.length > 0)
const wide = computed(() => leadsWithMedia.value)

const displayAuthor = computed(() => post.value.author || post.value.authorHandle || platformName.value)
const handle = computed(() => {
  const value = post.value.authorHandle
  if (!value) return null
  if (/^(@|u\/|r\/)/.test(value)) return value
  return post.value.platform === 'reddit' ? `u/${value}` : `@${value}`
})
const monogram = computed(() => (displayAuthor.value.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase())
const dateLabel = computed(() => {
  const date = post.value.publishedAt ? new Date(post.value.publishedAt) : null
  return date && !isNaN(date) ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null
})
const openUrl = computed(() => post.value.canonicalUrl || webToShow.value.url)

// ---- Media carousel -------------------------------------------------------
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const current = ref(0)
const [emblaRef, emblaApi] = emblaCarouselVue({ loop: false, align: 'center' })

const onSelect = () => { current.value = emblaApi.value?.selectedScrollSnap() ?? 0 }
watch(emblaApi, (api) => {
  if (!api) return
  api.on('select', onSelect).on('reInit', onSelect)
  onSelect()
})
watch(() => post.value.media, () => {
  current.value = 0
  emblaApi.value?.reInit()
})
onBeforeUnmount(() => emblaApi.value?.destroy())

const enlarge = (index) => {
  const item = post.value.media[index]
  if (item.kind === 'video') return window.open(openUrl.value, '_blank', 'noopener')
  lightboxIndex.value = index
  lightboxOpen.value = true
}
</script>

<style>
.social-post-view { container-type: inline-size; width: 100%; padding: 1.5rem 1rem 6rem; display: flex; justify-content: center; }
.social-post { width: 100%; }
.social-card .story { display: flex; flex-direction: column; gap: 1.5rem; padding: 1.75rem; }

.social-accent { color: var(--accent-l); }
.dark .social-accent { color: var(--accent-d); }
.social-monogram { background: color-mix(in srgb, currentColor 16%, transparent); }
.social-rule { width: 2rem; height: 3px; background: currentColor; opacity: 0.3; }
.social-open { background: color-mix(in srgb, currentColor 8%, transparent); text-decoration: none; }
.social-caption { margin: 0; font-size: 1rem; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }

/* The stage: the picture at its natural proportions over a blurred copy of itself. */
.social-stage { position: relative; overflow: hidden; border-radius: 20px; background: rgb(0 0 0 / 0.94); }
.social-track { display: flex; touch-action: pan-y pinch-zoom; }
.social-slide { position: relative; flex: 0 0 100%; min-width: 0; height: min(72vh, 640px, 125cqw); overflow: hidden; }
.social-backdrop { position: absolute; inset: -10%; width: 120%; height: 120%; max-width: none; object-fit: cover; filter: blur(32px); opacity: 0.28; pointer-events: none; }
.social-slide-button { position: absolute; inset: 0; display: grid; place-items: center; padding: 0.75rem; cursor: zoom-in; }
.social-picture { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; border-radius: 12px; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.1); user-select: none; }
.social-badge { position: absolute; top: 0.75rem; left: 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.7rem; border-radius: 999px; background: rgb(0 0 0 / 0.6); color: #fff; font-size: 0.75rem; font-weight: 500; pointer-events: none; }

.social-arrow { position: absolute; top: 50%; translate: 0 -50%; display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 999px; background: rgb(0 0 0 / 0.55); color: #fff; backdrop-filter: blur(8px); transition: opacity 0.15s, background 0.15s; }
.social-arrow:hover:not(:disabled) { background: rgb(0 0 0 / 0.75); }
.social-arrow:disabled { opacity: 0; pointer-events: none; }
.social-arrow--prev { left: 0.75rem; }
.social-arrow--next { right: 0.75rem; }

.social-dots { position: absolute; bottom: 0.75rem; left: 50%; translate: -50% 0; display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.7rem; border-radius: 999px; background: rgb(0 0 0 / 0.55); color: #fff; backdrop-filter: blur(8px); }
.social-count { margin-right: 0.3rem; font-size: 0.75rem; font-weight: 500; font-variant-numeric: tabular-nums; }
.social-dot { width: 6px; height: 6px; padding: 0; border-radius: 999px; background: rgb(255 255 255 / 0.4); transition: all 0.15s; }
.social-dot.is-current { width: 16px; background: #fff; }
</style>
