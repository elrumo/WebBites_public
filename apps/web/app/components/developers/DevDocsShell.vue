<template>
  <div class="dev-docs dark">
    <LandingNavBar :isLandingPage="false" />
    <img
      class="pointer-events-none fixed left-0 top-0 h-screen w-screen opacity-30 mix-blend-multiply"
      src="/images/grain_2.webp"
      alt=""
    >

    <!-- Phones and small tablets get the sidebar behind a button. -->
    <div class="dev-docs-mobilebar">
      <button type="button" class="dev-docs-mobilebtn" @click="navOpen = true">
        <UIcon name="i-heroicons-bars-3-bottom-left" class="size-4" />
        Docs menu
      </button>
      <span class="truncate text-sm text-neutral-400">{{ doc ? doc.title : 'Not found' }}</span>
    </div>

    <Transition name="dev-docs-fade">
      <div v-if="navOpen" class="dev-docs-overlay" @click="navOpen = false">
        <aside class="dev-docs-drawer" @click.stop>
          <div class="mb-4 flex items-center justify-between">
            <span class="text-sm font-semibold text-white">Documentation</span>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-x-mark"
              aria-label="Close menu"
              @click="navOpen = false"
            />
          </div>
          <DevDocsNav :current-slug="slug" @navigate="navOpen = false" />
        </aside>
      </div>
    </Transition>

    <div class="dev-docs-grid">
      <aside class="dev-docs-sidebar">
        <DevDocsNav :current-slug="slug" />
      </aside>

      <main class="dev-docs-main">
        <template v-if="doc">
          <div class="dev-docs-topbar">
            <p class="dev-docs-crumbs">
              <NuxtLink to="/developers/docs">Docs</NuxtLink>
              <span aria-hidden="true">/</span>
              <span>{{ doc.group }}</span>
            </p>

            <DevDocsShare :slug="slug" />
          </div>

          <h1 class="dev-docs-title">{{ doc.title }}</h1>
          <p class="dev-docs-description">{{ doc.description }}</p>

          <div ref="contentEl" class="docs-body" :key="slug">
            <component :is="section" />
          </div>

          <!-- Right rail collapses below xl, so the list moves inline there. -->
          <div class="dev-docs-toc-inline">
            <ClientOnly>
              <DevDocsToc :container="contentEl" :slug="slug" />
            </ClientOnly>
          </div>

          <nav class="dev-docs-pager" aria-label="Pagination">
            <NuxtLink v-if="previous" :to="docPath(previous.slug)" class="dev-docs-pager-link">
              <span class="dev-docs-pager-label">
                <UIcon name="i-heroicons-arrow-left" class="size-3.5" /> Previous
              </span>
              <span class="dev-docs-pager-title">{{ previous.title }}</span>
            </NuxtLink>
            <span v-else />
            <NuxtLink v-if="next" :to="docPath(next.slug)" class="dev-docs-pager-link text-right">
              <span class="dev-docs-pager-label justify-end">
                Next <UIcon name="i-heroicons-arrow-right" class="size-3.5" />
              </span>
              <span class="dev-docs-pager-title">{{ next.title }}</span>
            </NuxtLink>
          </nav>
        </template>

        <div v-else class="dev-docs-missing">
          <h1 class="dev-docs-title">Page not found</h1>
          <p class="dev-docs-description">
            There is no doc at this address. Pick one from the menu, or start at the
            <NuxtLink to="/developers/docs" class="text-green-300 underline underline-offset-4">introduction</NuxtLink>.
          </p>
        </div>
      </main>

      <aside class="dev-docs-rail">
        <ClientOnly>
          <DevDocsToc :container="contentEl" :slug="slug" />
        </ClientOnly>
      </aside>
    </div>

    <LandingFooter />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { findDoc, docNeighbours, docPath } from '~/utils/devDocs'
import DevDocsNav from '~/components/developers/DevDocsNav.vue'
import DevDocsToc from '~/components/developers/DevDocsToc.vue'
import DevDocsShare from '~/components/developers/DevDocsShare.vue'
import DevSectionIntroduction from '~/components/developers/DevSectionIntroduction.vue'
import DevSectionQuickstart from '~/components/developers/DevSectionQuickstart.vue'
import DevSectionAuthentication from '~/components/developers/DevSectionAuthentication.vue'
import DevSectionSaving from '~/components/developers/DevSectionSaving.vue'
import DevSectionSearching from '~/components/developers/DevSectionSearching.vue'
import DevSectionWebhooks from '~/components/developers/DevSectionWebhooks.vue'
import DevSectionErrors from '~/components/developers/DevSectionErrors.vue'
import DevSectionRateLimits from '~/components/developers/DevSectionRateLimits.vue'
import DevSectionRecipes from '~/components/developers/DevSectionRecipes.vue'
import DevSectionMcp from '~/components/developers/DevSectionMcp.vue'
import DevSectionApiKeys from '~/components/developers/DevSectionApiKeys.vue'
import DevSectionUsage from '~/components/developers/DevSectionUsage.vue'
import DevSectionPlayground from '~/components/developers/DevSectionPlayground.vue'
import DevSectionEndpoints from '~/components/developers/DevSectionEndpoints.vue'
import DevSectionBookmarkObject from '~/components/developers/DevSectionBookmarkObject.vue'

const props = defineProps({
  slug: { type: String, default: '' },
})

const SECTIONS = {
  '': DevSectionIntroduction,
  quickstart: DevSectionQuickstart,
  authentication: DevSectionAuthentication,
  'saving-bookmarks': DevSectionSaving,
  searching: DevSectionSearching,
  webhooks: DevSectionWebhooks,
  errors: DevSectionErrors,
  'rate-limits': DevSectionRateLimits,
  recipes: DevSectionRecipes,
  mcp: DevSectionMcp,
  'api-keys': DevSectionApiKeys,
  usage: DevSectionUsage,
  playground: DevSectionPlayground,
  endpoints: DevSectionEndpoints,
  'bookmark-object': DevSectionBookmarkObject,
}

const doc = computed(() => findDoc(props.slug))
const section = computed(() => SECTIONS[props.slug || ''] || null)
const previous = computed(() => docNeighbours(props.slug).previous)
const next = computed(() => docNeighbours(props.slug).next)

const contentEl = ref(null)
const navOpen = ref(false)

// A slug that matches no section is a 404 for crawlers too, not just for readers.
if (import.meta.server && !doc.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 404)
}

useHead({
  title: computed(() => (doc.value ? `${doc.value.title} - WebBites API docs` : 'WebBites API docs')),
  meta: [
    {
      name: 'description',
      content: computed(() => doc.value?.description || 'Guides, endpoints and a playground for the WebBites API.'),
    },
  ],
})

// The page transition is off for docs (so navigation is instant), which also
// disables Nuxt's transition-timed scroll reset. Do it ourselves: land at the
// top on every doc, whether the shell is reused (watch) or remounted per page
// (onMounted). nextTick lets the new section render first, so scroll anchoring
// can't drag us back down; a hash (a deep link, the recipe grid) is left alone.
const scrollToTop = async () => {
  if (!import.meta.client) return
  await nextTick()
  if (!window.location.hash) window.scrollTo(0, 0)
}
onMounted(scrollToTop)

// The drawer is fixed and scroll-locked; leaving the page must not strand it.
watch(() => props.slug, () => {
  navOpen.value = false
  scrollToTop()
})
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-docs {
  @apply relative min-h-screen bg-neutral-800 text-white;
  /* `h1-h6, p { color: var(--text-color) }` in main.css is unlayered and beats
     Tailwind's utilities, and nothing defines the token outside the landing
     wrapper — so pin the dark value here, as .landing-page-wrapper does. */
  --text-color: var(--color--gray-10, #efefef);
}

.dev-docs-mobilebar {
  @apply sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-neutral-800/90 px-4 py-3 backdrop-blur lg:hidden;
}

.dev-docs-mobilebtn {
  @apply flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white transition cursor-pointer;
  @apply hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}

.dev-docs-overlay { @apply fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden; }

.dev-docs-drawer {
  @apply h-full w-[19rem] max-w-[85vw] overflow-y-auto border-r border-white/10 bg-neutral-900 p-5;
}

.dev-docs-fade-enter-active,
.dev-docs-fade-leave-active { transition: opacity 0.2s ease; }
.dev-docs-fade-enter-from,
.dev-docs-fade-leave-to { opacity: 0; }

.dev-docs-grid {
  @apply relative z-[1] mx-auto grid w-[92%] max-w-7xl gap-10 pb-24 pt-8 lg:pt-16;
  @apply lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem];
}

.dev-docs-sidebar {
  @apply hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2;
  scrollbar-width: thin;
}

.dev-docs-rail {
  @apply hidden xl:block xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto;
}

.dev-docs-toc-inline { @apply mt-12 border-t border-white/10 pt-6 xl:hidden; }

.dev-docs-main { @apply min-w-0; }

.dev-docs-topbar { @apply flex items-center justify-between gap-4; }

.dev-docs-crumbs {
  @apply flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-500;
}
.dev-docs-crumbs a { @apply transition hover:text-green-300; }

.dev-docs-title { @apply mt-3 text-3xl font-black tracking-tight text-white md:text-4xl; }
.dev-docs-description { @apply mt-3 max-w-2xl text-lg leading-relaxed text-neutral-400; }

.dev-docs-missing { @apply pb-24; }

.dev-docs-pager { @apply mt-14 grid grid-cols-2 gap-4 border-t border-white/10 pt-6; }

.dev-docs-pager-link {
  @apply flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition;
  @apply hover:border-green-400/40 hover:bg-white/[0.05];
}
.dev-docs-pager-label {
  @apply flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500;
}
.dev-docs-pager-title { @apply text-sm font-semibold text-white; }

/* ── Prose. Section components write plain HTML; this styles it. ───────── */
.docs-body { @apply mt-10 flex flex-col gap-6; }

.docs-body :deep(section) { @apply flex flex-col gap-4; scroll-margin-top: 6rem; }

.docs-body :deep(h2) {
  @apply mt-6 text-2xl font-bold tracking-tight text-white;
  scroll-margin-top: 6rem;
}
.docs-body :deep(h3) {
  @apply mt-2 text-lg font-semibold text-white;
  scroll-margin-top: 6rem;
}
.docs-body :deep(h4) { @apply text-sm font-semibold uppercase tracking-wider text-neutral-400; }

.docs-body :deep(p) { @apply max-w-3xl text-[15px] leading-relaxed text-neutral-400; }
.docs-body :deep(p.docs-lead) { @apply text-lg text-neutral-300; }
.docs-body :deep(strong) { @apply font-semibold text-neutral-200; }

.docs-body :deep(ul),
.docs-body :deep(ol) { @apply flex max-w-3xl flex-col gap-2 pl-5 text-[15px] leading-relaxed text-neutral-400; }
.docs-body :deep(ul) { @apply list-disc; }
.docs-body :deep(ol) { @apply list-decimal; }
.docs-body :deep(li)::marker { @apply text-neutral-600; }

/* Prose links only. Cards, buttons and panels inside the body keep their own
   look — a blanket `a` rule turned every UButton into underlined green text. */
.docs-body :deep(p a),
.docs-body :deep(li a),
.docs-body :deep(td a),
.docs-body :deep(.docs-note a) {
  @apply text-green-300 underline underline-offset-4 decoration-green-300/40 transition hover:decoration-green-300;
}

/* Inline code only — the blocks inside DevCode style themselves. */
.docs-body :deep(:not(pre) > code) {
  @apply rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-green-200;
}

.docs-body :deep(.docs-card) {
  @apply rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition;
}
.docs-body :deep(.docs-card-hover:hover) { @apply border-green-400/40 bg-white/[0.06]; }
.docs-body :deep(.docs-cards) { @apply grid gap-4 sm:grid-cols-2; }
.docs-body :deep(a.docs-card) { @apply no-underline; }
.docs-body :deep(.docs-card-title) { @apply text-base font-bold text-white; }
.docs-body :deep(.docs-card-text) { @apply mt-1 text-sm leading-relaxed text-neutral-400; }

.docs-body :deep(.docs-note) {
  @apply rounded-xl border border-green-400/20 border-l-2 border-l-green-400/70 bg-green-400/[0.06] px-4 py-3 text-[15px] leading-relaxed text-neutral-300;
}
.docs-body :deep(.docs-note.warn) {
  @apply border-amber-400/20 border-l-amber-400/70 bg-amber-400/[0.06];
}
.docs-body :deep(.docs-note p) { @apply text-[15px] text-neutral-300; }

.docs-body :deep(.docs-table-wrap) { @apply overflow-x-auto rounded-xl border border-white/10; }
.docs-body :deep(.docs-table) { @apply w-full min-w-[32rem] border-collapse text-left text-sm; }
.docs-body :deep(.docs-table th) {
  @apply border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-neutral-400;
}
.docs-body :deep(.docs-table td) {
  @apply border-b border-white/5 px-4 py-2.5 align-top text-neutral-400;
}
.docs-body :deep(.docs-table tr:last-child td) { @apply border-b-0; }
.docs-body :deep(.docs-table td:first-child) { @apply font-medium text-neutral-200; }
</style>
