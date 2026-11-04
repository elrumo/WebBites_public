<template>
  <div class="app-listing mx-auto w-full max-w-[760px] px-4 py-8">
    <header class="flex items-start gap-5">
      <img
        v-if="app.icon"
        :src="app.icon"
        alt=""
        referrerpolicy="no-referrer"
        class="size-28 shrink-0 rounded-[25px] border border-black/10 bg-neutral-200 object-cover dark:border-white/10 dark:bg-neutral-800"
      >
      <div class="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
        <h2 class="text-2xl font-bold leading-tight">{{ app.name }}</h2>
        <p v-if="app.subtitle" class="line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">{{ app.subtitle }}</p>
        <a
          v-if="app.developerUrl && app.developer"
          :href="app.developerUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="app-accent text-sm hover:underline"
        >{{ app.developer }}</a>
        <p v-else-if="app.developer" class="app-accent text-sm">{{ app.developer }}</p>

        <div v-if="installUrl" class="mt-auto flex items-center gap-3 pt-3">
          <a
            :href="installUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="app-install inline-flex min-h-9 items-center rounded-full px-6 text-sm font-bold text-white"
          >{{ $t('website_modal.app.install') }}</a>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ $t('website_modal.app.on_store', { store: storeName }) }}<template v-if="app.inAppPurchases"> · {{ $t('website_modal.app.in_app_purchases') }}</template>
          </span>
        </div>
      </div>
    </header>

    <!-- The store's own strip of facts -->
    <dl v-if="facts.length" class="app-facts mt-6 flex overflow-x-auto rounded-2xl bg-white py-3 dark:bg-neutral-900">
      <div v-for="fact in facts" :key="fact.label" class="app-fact flex min-w-[96px] flex-1 flex-col items-center gap-1 px-5">
        <dt class="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ fact.label }}</dt>
        <dd class="m-0 flex flex-col items-center gap-0.5 text-center">
          <span v-if="fact.value" class="text-lg font-bold text-neutral-600 dark:text-neutral-300">{{ fact.value }}</span>
          <span v-if="fact.caption" class="max-w-[140px] truncate text-xs text-neutral-500 dark:text-neutral-400">{{ fact.caption }}</span>
        </dd>
      </div>
    </dl>

    <div v-if="app.screenshots.length" class="app-shots mt-6 flex snap-x gap-3 overflow-x-auto pb-2">
      <button
        v-for="(shot, i) in app.screenshots"
        :key="shot"
        type="button"
        class="shrink-0 snap-start"
        :aria-label="$t('website_modal.social.enlarge')"
        @click="enlarge(i)"
      >
        <img
          :src="shot"
          alt=""
          referrerpolicy="no-referrer"
          draggable="false"
          :loading="i < 3 ? 'eager' : 'lazy'"
          class="h-[420px] w-auto rounded-[18px] border border-black/10 bg-neutral-200 object-cover dark:border-white/10 dark:bg-neutral-800"
        >
      </button>
    </div>

    <section v-if="app.description" class="mt-6">
      <p class="whitespace-pre-line text-[15px] leading-relaxed" :class="expanded ? '' : 'line-clamp-6'">{{ app.description }}</p>
      <button
        v-if="!expanded && app.description.length > 280"
        type="button"
        class="app-accent mt-1 text-sm font-semibold hover:underline"
        @click="expanded = true"
      >{{ $t('website_modal.app.more') }}</button>
    </section>

    <section v-if="app.releaseNotes" class="mt-6">
      <div class="flex items-baseline justify-between">
        <h3 class="text-lg font-bold">{{ $t('website_modal.app.whats_new') }}</h3>
        <span v-if="app.version" class="text-xs text-neutral-500 dark:text-neutral-400">{{ $t('website_modal.app.version', { version: app.version }) }}</span>
      </div>
      <p class="mt-2 line-clamp-8 whitespace-pre-line text-sm">{{ app.releaseNotes }}</p>
    </section>

    <section class="mt-6 rounded-2xl bg-white p-4 dark:bg-neutral-900">
      <h3 class="text-lg font-bold">{{ $t('website_modal.app.information') }}</h3>
      <dl class="mt-2 divide-y divide-black/5 dark:divide-white/10">
        <div v-for="row in rows" :key="row.label" class="flex items-baseline justify-between gap-6 py-3 text-sm">
          <dt class="text-neutral-500 dark:text-neutral-400">{{ row.label }}</dt>
          <dd class="m-0 text-right">{{ row.value }}</dd>
        </div>
      </dl>
      <div class="mt-2 flex gap-6 text-sm">
        <a v-if="app.developerUrl" :href="app.developerUrl" target="_blank" rel="noopener noreferrer" class="app-accent inline-flex items-center gap-1 hover:underline">
          {{ $t('website_modal.app.developer_website') }}<UIcon name="i-heroicons-arrow-up-right" class="size-3.5" />
        </a>
        <a v-if="app.privacyUrl" :href="app.privacyUrl" target="_blank" rel="noopener noreferrer" class="app-accent inline-flex items-center gap-1 hover:underline">
          {{ $t('website_modal.app.privacy_policy') }}<UIcon name="i-heroicons-arrow-up-right" class="size-3.5" />
        </a>
      </div>
    </section>

    <vue-easy-lightbox
      :visible="lightboxOpen"
      :imgs="app.screenshots"
      :index="lightboxIndex"
      :move-disabled="false"
      @hide="lightboxOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { t, locale } = useI18n()
const { webToShow } = storeToRefs(useStore())

// The modal keeps one instance while you page between bites, so everything is
// derived from `webToShow`.
const app = computed(() => appListingOf(webToShow.value) ?? { screenshots: [], languages: [] })

const storeName = computed(() => (app.value.store === 'playstore' ? 'Google Play' : 'App Store'))
const installUrl = computed(() => {
  const { storeUrl, store, appId } = app.value
  if (storeUrl) return storeUrl
  if (!appId) return null
  return store === 'playstore'
    ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`
    : `https://apps.apple.com/app/id${appId}`
})

const expanded = ref(false)
const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
const enlarge = (i) => { lightboxIndex.value = i; lightboxOpen.value = true }
watch(() => webToShow.value?.objectId, () => { expanded.value = false })

const compact = (n) => new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const facts = computed(() => {
  const a = app.value
  const list = []
  if (a.rating != null) {
    list.push({
      label: a.ratingCount ? t('website_modal.app.ratings', { count: compact(a.ratingCount) }) : t('website_modal.app.rating'),
      value: a.rating.toFixed(1),
      caption: '★'.repeat(Math.round(a.rating)),
    })
  }
  if (a.ageRating) list.push({ label: t('website_modal.app.age'), value: a.ageRating })
  if (a.category) list.push({ label: t('website_modal.app.category'), caption: a.category })
  if (a.developer) list.push({ label: t('website_modal.app.developer'), caption: a.developer })
  if (a.languages.length) {
    list.push({
      label: t('website_modal.app.language'),
      value: a.languages[0],
      caption: a.languages.length > 1 ? t('website_modal.app.more_languages', { count: a.languages.length - 1 }) : '',
    })
  }
  const size = formatAppSize(a.sizeBytes)
  if (size) list.push({ label: t('website_modal.app.size'), value: size })
  else if (a.installs) list.push({ label: t('website_modal.app.downloads'), value: a.installs })
  return list
})

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }) : null)

const rows = computed(() => {
  const a = app.value
  const size = formatAppSize(a.sizeBytes)
  const entries = [
    [t('website_modal.app.seller'), a.developer],
    [t('website_modal.app.size'), size],
    [t('website_modal.app.category'), a.category],
    [t('website_modal.app.compatibility'), a.minOS && t('website_modal.app.requires', { os: a.minOS })],
    [t('website_modal.app.languages'), a.languages.length
      ? (a.languages.length > 1 ? t('website_modal.app.and_more', { first: a.languages[0], count: a.languages.length - 1 }) : a.languages[0])
      : null],
    [t('website_modal.app.age_rating'), a.ageRating],
    [t('website_modal.app.in_app_purchases'), a.inAppPurchases == null ? null : t(a.inAppPurchases ? 'website_modal.app.yes' : 'website_modal.app.no')],
    [t('website_modal.app.price'), a.price],
    [t('website_modal.app.downloads'), a.installs],
    [t('website_modal.app.updated'), formatDate(a.updatedAt)],
    [t('website_modal.app.copyright'), a.copyright],
  ]
  return entries.filter(([, value]) => value).map(([label, value]) => ({ label, value }))
})
</script>

<style scoped>
.app-listing {
  --app-accent: #0a6fd6;
  --app-install: #0a6fd6;
}
:global(.dark) .app-listing { --app-accent: #4aa3ff; }
.app-accent { color: var(--app-accent); }
.app-install { background: var(--app-install); }
.app-install:hover { filter: brightness(1.08); }
.app-fact + .app-fact { border-left: 1px solid rgb(0 0 0 / 0.08); }
:global(.dark) .app-fact + .app-fact { border-left-color: rgb(255 255 255 / 0.12); }
</style>
