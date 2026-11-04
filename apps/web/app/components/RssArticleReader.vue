<template>
  <div class="rss-reader">
    <div v-if="activeRssItemLoading" class="rss-reader-body">
      <USkeleton class="w-full h-56 rounded-xl" />
      <div class="flex flex-col gap-2">
        <USkeleton class="h-7 w-11/12 rounded" />
        <USkeleton class="h-7 w-3/5 rounded" />
      </div>
      <USkeleton class="h-4 w-1/2 rounded" />
      <div class="rss-prose-skeleton">
        <USkeleton v-for="n in 9" :key="n" class="h-4 rounded" :class="n % 4 === 0 ? 'w-2/3 mb-4' : 'w-full'" />
      </div>
    </div>

    <div v-else-if="!activeRssItem" class="rss-reader-empty">
      <UIcon name="i-tabler-article" class="w-10 h-10 opacity-30" />
      <p class="font-medium m-0">{{ $t('rss.reader.no_article') }}</p>
      <p class="text-sm opacity-60 m-0">{{ $t('rss.reader.pick_article') }}</p>
    </div>

    <article v-else class="rss-reader-body">
      <header class="flex flex-col gap-3">
        <div class="flex justify-end -mb-2">
          <UDropdownMenu :items="menuItems">
            <UButton size="xs" variant="ghost" icon="i-tabler-dots" square />
          </UDropdownMenu>
        </div>
        <img
          v-if="activeRssItem.imageUrl"
          :src="activeRssItem.imageUrl"
          class="w-full max-h-72 object-cover rounded-xl"
          alt=""
          @error="hideImage"
        />

        <h1 class="text-2xl font-semibold leading-tight m-0">
          {{ activeRssItem.title }}
        </h1>

        <div class="flex items-center gap-2 text-sm opacity-60 flex-wrap">
          <span>{{ activeRssItem.feedTitle }}</span>
          <template v-if="activeRssItem.author">
            <span>·</span><span>{{ activeRssItem.author }}</span>
          </template>
          <template v-if="publishedLabel">
            <span>·</span><span>{{ publishedLabel }}</span>
          </template>
          <UButton
            v-if="activeRssItem.link"
            size="xs"
            variant="ghost"
            icon="i-tabler-external-link"
            :to="activeRssItem.link"
            target="_blank"
            :label="$t('rss.reader.original')"
          />
          <UButton
            size="xs"
            variant="ghost"
            icon="i-tabler-circle"
            :label="$t('rss.reader.mark_unread')"
            @click="markUnread"
          />
        </div>
      </header>

      <CardSummary
        v-if="activeRssItem.aiSummary && summaryHasContent"
        :summary="activeRssItem.aiSummary"
        :website="summaryWebsite"
        :showImage="false"
        :inLine="true"
        :compact="true"
      />

      <UButton
        v-else-if="canSummarise"
        :loading="summarising"
        variant="soft"
        icon="i-tabler-sparkles"
        class="w-fit"
        :label="$t('rss.reader.summarise')"
        @click="summarise"
      />

      <!-- Audio. The element is always mounted so `listen` can hand it a
           MediaSource before the first byte arrives. -->
      <div class="flex items-center gap-2">
        <UButton
          v-if="!audioReady"
          :loading="audioLoading"
          :disabled="!hasReadableText"
          variant="soft"
          icon="i-tabler-headphones"
          class="w-fit"
          :label="$t('rss.reader.listen')"
          @click="listen"
        />
        <AudioVoicePicker v-if="!audioReady" />
        <audio ref="audioEl" controls class="w-full max-w-md" :class="{ hidden: !audioReady }" />
      </div>

      <div v-if="loadingFullText" class="rss-prose-skeleton">
        <USkeleton v-for="n in 9" :key="n" class="h-4 rounded" :class="n % 4 === 0 ? 'w-2/3 mb-4' : 'w-full'" />
      </div>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        v-else-if="displayedHtml"
        class="rss-prose"
        v-html="displayedHtml"
      />

      <div v-else class="rss-reader-empty py-10">
        <UIcon name="i-tabler-file-text" class="w-8 h-8 opacity-30" />
        <p class="font-medium m-0">{{ $t('rss.reader.nothing_to_read') }}</p>
        <p class="text-sm opacity-60 m-0">{{ emptyBodyExplanation }}</p>
        <UButton
          v-if="activeRssItem.link"
          size="sm"
          variant="soft"
          :to="activeRssItem.link"
          target="_blank"
          :label="$t('rss.reader.open_original')"
        />
      </div>
    </article>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { expandImageMarkers } from '~/utils/imageMarkers'

const { t } = useI18n()
const store = useStore()
const { activeRssItem, activeRssItemLoading } = storeToRefs(store)

const source = ref('feed')
const fullTextHtml = ref(null)
const loadingFullText = ref(false)
const summarising = ref(false)
const audioEl = ref(null)
const audioReady = ref(false)
const audioLoading = ref(false)

const menuItems = computed(() => {
  const item = activeRssItem.value
  if (!item) return []
  const isRead = store.rssItems.find(row => row.id === item.id)?.isRead ?? true
  return [[
    {
      label: isRead ? t('rss.mark_unread') : t('rss.mark_read'),
      icon: isRead ? 'i-tabler-circle' : 'i-tabler-circle-check',
      onSelect: () => store.setRssItemRead(item.id, !isRead)
    }
  ], [
    {
      label: t('rss.reader.save_bookmark'),
      icon: 'i-tabler-bookmark-plus',
      disabled: !item.link,
      onSelect: () => store.saveBookmark({ url: item.link, savedFrom: 'rss' })
    },
    {
      label: item.isReadLater ? t('rss.reader.remove_read_later') : t('rss.reader.add_read_later'),
      icon: 'i-tabler-bookmark',
      onSelect: toggleReadLater
    },
    {
      label: source.value === 'fullText' ? t('rss.reader.show_original') : t('rss.reader.show_extracted'),
      icon: source.value === 'fullText' ? 'i-tabler-rss' : 'i-tabler-file-text',
      disabled: !item.link,
      onSelect: toggleSource
    }
  ]]
})

const hasFullText = computed(() =>
  Boolean(activeRssItem.value?.extractedFileUrl || activeRssItem.value?.extractedText)
)

const hasReadableText = computed(() =>
  Boolean(activeRssItem.value?.extractedText || activeRssItem.value?.rssContentText)
)

const readableLength = computed(() =>
  (activeRssItem.value?.extractedText || activeRssItem.value?.rssContentText || '').length
)

/** The backend needs 200 chars; a headline-only item can still get there via extraction. */
const canSummarise = computed(() => readableLength.value >= 200 || Boolean(activeRssItem.value?.link))

const summaryHasContent = computed(() => {
  const summary = activeRssItem.value?.aiSummary
  return Boolean(summary?.whatIsThisPageAbout || summary?.tldr || summary?.pointsThatBestDescribeThePage?.length)
})

/**
 * `CardSummary` renders a bookmark's `aiSummary`, and an RSS article's has the
 * exact same shape — passed via `:summary`. `website` only feeds the image
 * slots, so a minimal object beats faking a whole `webToShow`.
 */
const summaryWebsite = computed(() => ({
  aiSummary: activeRssItem.value?.aiSummary,
  siteTitle: activeRssItem.value?.title,
  url: activeRssItem.value?.link
}))

const displayedHtml = computed(() => {
  const item = activeRssItem.value
  if (!item) return ''
  if (source.value === 'fullText') {
    // The file has not arrived yet — the feed's own body beats a blank pane.
    return expandImageMarkers(fullTextHtml.value || item.rssContentHtml || '')
  }
  return expandImageMarkers(item.rssContentHtml || '')
})

/** The two "empty" cases read very differently to a user; say which it is. */
const emptyBodyExplanation = computed(() => {
  switch (activeRssItem.value?.extractionStatus) {
    case 'failed':
      return t('rss.reader.empty_failed')
    case 'pending':
      return t('rss.reader.empty_pending')
    default:
      return t('rss.reader.empty_headlines')
  }
})

const publishedLabel = computed(() => {
  if (!activeRssItem.value?.publishedAt) return ''
  const date = new Date(activeRssItem.value.publishedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
})

/**
 * Reset per article, and open on the better body when there is one: a reader
 * who paid for extraction did so precisely to avoid the teaser.
 */
watch(activeRssItem, (item) => {
  fullTextHtml.value = null
  resetAudio(item?.articleAudioUrl || null)
  source.value = item && (item.extractedFileUrl || item.extractedText) ? 'fullText' : 'feed'
  if (source.value === 'fullText') loadFullText()
})

watch(source, (value) => {
  if (value === 'fullText') loadFullText()
})

/**
 * Fetches the extracted article HTML from its file, lazily and once.
 *
 * The same pattern `WebsiteModal` uses for `siteBodyFileUrl`: the list and
 * detail payloads carry only a URL, so nothing downloads until the reader
 * actually asks to see the full text.
 */
const loadFullText = async () => {
  if (fullTextHtml.value !== null || loadingFullText.value) return
  const item = activeRssItem.value
  if (!item) return

  if (!item.extractedFileUrl) {
    // Extraction ran but the file save did not. The plain text survived, and
    // reading it beats an empty pane.
    if (item.extractedText) {
      fullTextHtml.value = item.extractedText
        .split('\n')
        .filter(Boolean)
        .map(paragraph => `<p>${escapeHtml(paragraph)}</p>`)
        .join('')
    }
    return
  }

  loadingFullText.value = true
  try {
    fullTextHtml.value = await $fetch(item.extractedFileUrl, { responseType: 'text' })
  } catch (error) {
    console.error('[RSS] Full-text fetch failed:', error)
  } finally {
    loadingFullText.value = false
  }
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const summarise = async () => {
  const item = activeRssItem.value
  if (!item) return
  summarising.value = true
  try {
    const { generateSummary, extractItem, fetchItem } = useRssFeeds()
    // Too short to summarise from the feed body alone: pull the full text first.
    if (readableLength.value < 200 && !hasFullText.value) {
      const result = await extractItem(item.id)
      if (result.status !== 'done') {
        store.showAlert({ message: t('rss.reader.too_short'), type: 'danger' })
        return
      }
      Object.assign(item, (await fetchItem(item.id)).item)
    }
    const response = await generateSummary(item.id)
    if (response?.aiSummary) {
      item.aiSummary = response.aiSummary
      const row = store.rssItems.find(candidate => candidate.id === item.id)
      if (row) row.hasSummary = true
    }
  } catch (error) {
    if (isUsageError(error)) {
      store.showUpgradeModal = true
    } else {
      console.error('[RSS] Summary failed:', error)
      store.showAlert({ message: t('rss.reader.summary_failed'), type: 'danger' })
    }
  } finally {
    summarising.value = false
  }
}

/**
 * Points the player at a ready MP3 (cached audio) or hides it. Called per
 * article so one article's stream never plays under the next one's title.
 */
const resetAudio = (url) => {
  const el = audioEl.value
  if (el) {
    el.pause()
    if (el.src?.startsWith('blob:')) URL.revokeObjectURL(el.src)
    el.removeAttribute('src')
    el.load()
    if (url) el.src = url
  }
  audioReady.value = Boolean(url)
}

/**
 * Streams the TTS response into the player. Binding the proxy URL straight to
 * `<audio src>` does not work: the backend answers chunked with no
 * Content-Length or range support, so the element stalls at 0:00. Feeding the
 * bytes through MediaSource plays progressively; browsers without MP3 MSE
 * (Safari) wait for the whole file as a blob — the same pair `ReaderView`
 * uses for bookmarks.
 */
const playStream = async (response) => {
  const el = audioEl.value
  if (!('MediaSource' in window) || !MediaSource.isTypeSupported('audio/mpeg')) {
    el.src = URL.createObjectURL(await response.blob())
    audioReady.value = true
    el.play().catch(() => {})
    return
  }

  const mediaSource = new MediaSource()
  el.src = URL.createObjectURL(mediaSource)
  audioReady.value = true
  await new Promise(resolve => mediaSource.addEventListener('sourceopen', resolve, { once: true }))

  const buffer = mediaSource.addSourceBuffer('audio/mpeg')
  const idle = () => buffer.updating
    ? new Promise(resolve => buffer.addEventListener('updateend', resolve, { once: true }))
    : Promise.resolve()
  const reader = response.body.getReader()
  let started = false
  // The stream belongs to the article that was open when it began; if the
  // reader moved on, `resetAudio` swapped the src and this source is detached.
  while (mediaSource.readyState === 'open') {
    const { done, value } = await reader.read()
    if (done) break
    await idle()
    if (mediaSource.readyState !== 'open') break
    buffer.appendBuffer(value)
    if (!started) {
      started = true
      el.play().catch(() => {})
    }
  }
  await idle()
  if (mediaSource.readyState === 'open') mediaSource.endOfStream()
}

const listen = async () => {
  if (!activeRssItem.value) return
  audioLoading.value = true
  try {
    const { requestAudio } = useRssFeeds()
    const response = await requestAudio(activeRssItem.value.id, store.userOptions.aiVoice, store.userOptions.aiAccent)

    if (response.audioUrl) {
      resetAudio(response.audioUrl)
      audioEl.value?.play().catch(() => {})
      return
    }

    const stream = await fetch(`/api/v1/audio/streamAudio?endpoint=${encodeURIComponent(response.endpoint)}`, {
      headers: { Accept: 'audio/mpeg' }
    })
    if (!stream.ok) {
      const data = await stream.json().catch(() => null)
      throw Object.assign(new Error(data?.message || 'Audio stream failed'), { data })
    }
    await playStream(stream)
  } catch (error) {
    // A spent quota is an upgrade prompt, not a failure toast — the proxy
    // forwards the backend's `errorType`/`quotaKind` for exactly this.
    if (isUsageError(error)) {
      store.showUpgradeModal = true
    } else {
      console.error('[RSS] Audio request failed:', error)
      store.showAlert({ message: t('rss.reader.audio_failed'), type: 'danger' })
    }
    resetAudio(null)
  } finally {
    audioLoading.value = false
  }
}

const isUsageError = (error) =>
  [error?.data?.data?.errorType, error?.data?.errorType].includes('UsageError')

const toggleReadLater = async () => {
  const item = activeRssItem.value
  if (!item) return
  const saved = !item.isReadLater
  item.isReadLater = saved
  const row = store.rssItems.find(candidate => candidate.id === item.id)
  if (row) row.isReadLater = saved
  try {
    const { setReadLater } = useRssFeeds()
    await setReadLater(item.id, saved)
    store.showAlert({ message: saved ? t('rss.reader.saved_read_later') : t('rss.reader.removed_read_later') })
  } catch (error) {
    console.error('[RSS] Read later failed:', error)
    item.isReadLater = !saved
    if (row) row.isReadLater = !saved
    store.showAlert({ message: t('rss.reader.read_later_failed'), type: 'danger' })
  }
}

/**
 * Feed body ⇄ extracted article. The first switch on an unextracted article
 * runs extraction on the backend, then reloads the detail so the new file URL
 * and text arrive together.
 */
const toggleSource = async () => {
  const item = activeRssItem.value
  if (!item) return
  if (source.value === 'fullText') {
    source.value = 'feed'
    return
  }
  if (hasFullText.value) {
    source.value = 'fullText'
    return
  }

  loadingFullText.value = true
  try {
    const { extractItem, fetchItem } = useRssFeeds()
    const result = await extractItem(item.id)
    if (result.status !== 'done') {
      store.showAlert({ message: t('rss.reader.empty_failed'), type: 'danger' })
      return
    }
    const detail = (await fetchItem(item.id)).item
    if (activeRssItem.value?.id !== item.id) return
    Object.assign(activeRssItem.value, detail)
    source.value = 'fullText'
  } catch (error) {
    if (isUsageError(error)) {
      store.showUpgradeModal = true
    } else {
      console.error('[RSS] Extraction failed:', error)
      store.showAlert({ message: t('rss.reader.extract_failed'), type: 'danger' })
    }
  } finally {
    loadingFullText.value = false
  }
}

const markUnread = async () => {
  if (!activeRssItem.value) return
  await store.setRssItemRead(activeRssItem.value.id, false)
}

const hideImage = (event) => {
  event.target.style.display = 'none'
}
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.rss-reader {
  @apply flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain;
}

.rss-reader-body {
  @apply flex flex-col gap-5 max-w-[720px] mx-auto px-6 py-8;
}

.rss-reader-empty {
  @apply flex flex-col items-center justify-center gap-2 text-center h-full px-6 py-20;
}

.rss-prose-skeleton {
  @apply flex flex-col gap-2.5 mt-2;
}
</style>

<style>
@reference "../assets/css/tailwind.css";

/* Feed bodies are arbitrary publisher markup, so the typography is applied to
   descendants rather than assumed on the elements themselves. Not scoped:
   `v-html` content carries no scope attribute. */
.rss-prose {
  @apply text-[17px] leading-relaxed;
}

.rss-prose p { @apply my-4; }
.rss-prose h1 { @apply text-2xl font-semibold mt-8 mb-3; }
.rss-prose h2 { @apply text-xl font-semibold mt-8 mb-3; }
.rss-prose h3 { @apply text-lg font-semibold mt-6 mb-2; }
.rss-prose ul { @apply list-disc pl-6 my-4; }
.rss-prose ol { @apply list-decimal pl-6 my-4; }
.rss-prose li { @apply my-1; }
/* Accent via the variable, not `@apply`: Nuxt UI's theme layer is not loaded
   by `@reference "tailwindcss"`. */
.rss-prose a { @apply underline underline-offset-2; color: var(--color-primary-600); }
.dark .rss-prose a { color: var(--color-primary-400); }
.rss-prose img { @apply max-w-full h-auto rounded-lg my-4; }
.rss-prose blockquote { @apply border-l-4 border-neutral-300 dark:border-neutral-600 pl-4 italic my-4 opacity-80; }
.rss-prose pre { @apply bg-neutral-100 dark:bg-neutral-800 rounded-lg p-4 overflow-x-auto my-4 text-sm; }
.rss-prose code { @apply text-sm; }
.rss-prose figure { @apply my-4; }
.rss-prose figcaption { @apply text-xs opacity-60 mt-1; }
.rss-prose table { @apply w-full my-4 text-sm; }
.rss-prose hr { @apply my-8 border-neutral-200 dark:border-neutral-700; }
</style>
