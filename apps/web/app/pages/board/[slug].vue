<template>
  <div class="shared-board dark relative min-h-screen overflow-x-clip bg-neutral-800 text-neutral-100">
    <img
      class="pointer-events-none fixed left-0 top-0 h-screen w-screen opacity-40 mix-blend-multiply"
      src="/images/grain_2.webp"
      alt=""
    >
    <!-- The board's own color is the one loud thing on the page. -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-[26rem]"
      :style="{ background: `linear-gradient(to bottom, color-mix(in srgb, ${accent} 22%, transparent), transparent)` }"
      aria-hidden="true"
    />

    <header class="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4">
      <NuxtLink to="/" aria-label="WebBites">
        <Logo :is-image="true" :is-text="true" image-size="sm" />
      </NuxtLink>
      <UButton
        :to="loggedIn ? '/app' : '/'"
        color="neutral"
        class="rounded-full font-bold"
        :label="loggedIn ? $t('boards.public.open_webbites') : $t('boards.public.save_your_own')"
      />
    </header>

    <main class="relative z-10 mx-auto max-w-7xl px-4 pb-16">
      <div v-if="errorCopy" class="flex max-w-lg flex-col items-start gap-3 py-24">
        <UIcon :name="errorCopy.icon" class="size-10 text-neutral-400" />
        <h1 class="text-3xl font-extrabold tracking-tight">{{ errorCopy.title }}</h1>
        <p class="text-neutral-400">{{ errorCopy.text }}</p>
        <UButton to="/" color="neutral" class="mt-2 rounded-full font-bold" :label="$t('boards.go_home')" />
      </div>

      <template v-else-if="board">
        <section class="flex max-w-3xl flex-col items-start gap-3 pb-10 pt-8 sm:pb-12 sm:pt-14">
          <span v-if="board.icon" class="text-6xl leading-none sm:text-7xl" aria-hidden="true">{{ board.icon }}</span>
          <h1 class="break-words text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">{{ board.name }}</h1>
          <p v-if="board.description" class="max-w-prose text-lg leading-snug text-neutral-300">{{ board.description }}</p>

          <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-400">
            <span class="flex items-center gap-2">
              <span
                class="flex size-6 items-center justify-center rounded-full text-xs font-bold text-neutral-900"
                :style="{ backgroundColor: accent }"
              >{{ ownerName.charAt(0).toUpperCase() }}</span>
              {{ $t('boards.public.shared_by', { name: ownerName }) }}
            </span>
            <span>{{ $t('boards.public.bookmark_count', total) }}</span>
          </div>
        </section>

        <p v-if="!items.length" class="py-16 text-neutral-400">{{ $t('boards.public.empty') }}</p>

        <div class="grid w-full grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <div v-for="site in cards" :key="site.objectId" class="masonry-item" style="min-width: 0">
            <BookmarkCard :website="site" readonly />
          </div>
        </div>

        <div v-if="fetched < total" class="mt-10">
          <UButton
            color="neutral"
            variant="outline"
            class="rounded-full font-bold"
            :label="$t('boards.public.show_more')"
            :loading="loadingMore"
            @click="loadMore"
          />
        </div>

        <footer class="mt-20 flex flex-col gap-4 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p class="max-w-md text-neutral-400">
            {{ $t('boards.public.footer') }}
          </p>
          <UButton
            :to="loggedIn ? '/app' : '/'"
            color="neutral"
            size="lg"
            class="w-fit shrink-0 rounded-full font-bold"
            :label="loggedIn ? $t('boards.public.open_webbites') : $t('boards.public.start_free')"
          />
        </footer>
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const { t } = useI18n()

// No login: this is what a link-share recipient sees. The token in the query
// string is the whole credential, so it is not worth indexing.
definePageMeta({ pageTransition: false })

const route = useRoute()
const slug = String(route.params.slug || '')
const token = String(route.query.token || '')

// Board colors are user content: only a plain hex ever reaches a style.
const accent = computed(() => (/^#[0-9a-f]{6}$/i.test(board.value?.color || '') ? board.value.color : '#4ade80'))

const loggedIn = computed(() => Boolean(useCookie('parse.session').value))

const PAGE_SIZE = 50
const fetchPage = (skip) => $fetch(`/api/v1/public/boards/${encodeURIComponent(slug)}`, {
  query: { token, limit: PAGE_SIZE, skip }
})

const { data, error } = await useAsyncData(`public-board-${slug}`, () => fetchPage(0))

const board = computed(() => data.value?.board ?? null)
const ownerName = computed(() => data.value?.ownerName || t('boards.someone'))
const total = computed(() => data.value?.totalBookmarks ?? 0)
// A membership whose bookmark was deleted comes back with no website.
const items = ref((data.value?.items ?? []).filter(item => item?.website?.id))
// Rows asked for so far, dead ones included: the server pages over all of them.
const fetched = ref(data.value?.items?.length ?? 0)
const loadingMore = ref(false)

useHead(() => ({
  title: board.value ? t('boards.public.title', { name: board.value.name }) : t('boards.public.title_default'),
  meta: [{ name: 'robots', content: 'noindex' }]
}))

const errorCopy = computed(() => {
  if (!error.value) return null
  const status = error.value.statusCode ?? error.value.status
  if (status === 404) return { icon: 'i-tabler-map-question', title: t('boards.public.not_found_title'), text: t('boards.public.not_found_text') }
  if (status === 403) return { icon: 'i-tabler-lock', title: t('boards.public.forbidden_title'), text: t('boards.public.forbidden_text') }
  return { icon: 'i-tabler-cloud-off', title: t('boards.public.error_title'), text: t('boards.public.error_text') }
})

const loadMore = async () => {
  loadingMore.value = true
  try {
    const page = await fetchPage(fetched.value)
    const rows = page?.items ?? []
    // An empty page means the total was stale; stop rather than ask forever.
    fetched.value = rows.length ? fetched.value + rows.length : total.value
    items.value.push(...rows.filter(item => item?.website?.id && !items.value.some(have => have.website.id === item.website.id)))
  } catch (e) {
    console.error('Error loading more of the shared board:', e)
  } finally {
    loadingMore.value = false
  }
}

// Bookmark URLs are user content; only web links reach the card's href.
// BookmarkCard wants the Parse-style `objectId` the public payload calls `id`.
const cards = computed(() => items.value.map(({ website }) => ({
  ...website,
  objectId: website.id,
  url: /^https?:\/\//i.test(website.url || '') ? website.url : ''
})))
</script>

