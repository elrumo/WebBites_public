<template>
  <div class="faq-page">
    <LandingNavBar :isLandingPage="true" />
    <img class="fixed top-0 left-0 w-screen h-screen mix-blend-multiply opacity-40 pointer-events-none" src="/images/grain_2.webp" alt="" />

    <header class="faq-hero">
      <h1 class="faq-title">
        {{ $t('faq.title_line1') }}
        <span class="block landing-page-title text-shadow-green">{{ $t('faq.title_emphasis') }}</span>
      </h1>
      <p class="hero-subtitle">
        {{ $t('faq.subtitle') }}
      </p>
    </header>

    <div class="faq-body">
      <!-- Topic rail. Reads like the tag list in the app. -->
      <nav class="faq-topics" :aria-label="$t('faq.topics_aria')">
        <button
          v-for="topic in topics"
          :key="topic.id"
          type="button"
          class="faq-chip"
          :class="{ active: active === topic.id }"
          :aria-pressed="active === topic.id"
          @click="active = topic.id"
        >
          <span class="faq-chip-emoji">{{ topic.emoji }}</span>
          {{ topic.label }}
          <span class="faq-chip-count">{{ count(topic.id) }}</span>
        </button>
      </nav>

      <div class="faq-list">
        <details
          v-for="f in visible"
          :id="f.id"
          :key="f.id"
          class="faq-bite"
          :open="opened === f.id"
          @toggle="e => e.target.open && (opened = f.id)"
        >
          <summary>
            <span class="faq-bite-emoji">{{ f.emoji }}</span>
            <span class="faq-bite-q">{{ f.q }}</span>
            <span class="faq-bite-plus" aria-hidden="true"></span>
          </summary>
          <div class="faq-bite-a" v-html="f.a"></div>
        </details>
      </div>
    </div>

    <section class="info-landing-wrapper py-32">
      <div class="flex flex-col gap-4 items-center">
        <h2 class="landing-page-title text-4xl md:text-5xl text-center pb-1">{{ $t('faq.still_stuck.title') }}</h2>
        <p class="hero-subtitle">
          {{ $t('faq.still_stuck.body') }}
        </p>
        <div class="flex flex-wrap justify-center gap-4 dark pt-2">
          <UButton color="neutral" :to="`mailto:${LEGAL.email}`" size="lg" class="font-bold rounded-xl">
            {{ $t('faq.still_stuck.email_button', { email: LEGAL.email }) }}
          </UButton>
          <UButton color="neutral" variant="outline" to="/feedback" size="lg" class="font-bold rounded-xl">
            {{ $t('faq.still_stuck.feature_button') }}
          </UButton>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { LEGAL } from '~/utils/legal'

const { t } = useI18n()

useHead({ title: () => `WebBites - ${t('navigation.faq')}` })

const topics = computed(() => [
  { id: 'all', emoji: '🍪', label: t('faq.topics.all') },
  { id: 'start', emoji: '✨', label: t('faq.topics.start') },
  { id: 'saving', emoji: '🔖', label: t('faq.topics.saving') },
  { id: 'billing', emoji: '💳', label: t('faq.topics.billing') },
  { id: 'privacy', emoji: '🔒', label: t('faq.topics.privacy') },
  { id: 'dev', emoji: '🛠️', label: t('faq.topics.dev') },
])

// Answers are plain HTML so links can sit inline. Keep them short.
const faqs = computed(() => [
  { id: 'what', tag: 'start', emoji: '🍪', q: t('faq.items.what.q'), a: t('faq.items.what.a') },
  { id: 'platforms', tag: 'start', emoji: '📱', q: t('faq.items.platforms.q'), a: t('faq.items.platforms.a') },
  { id: 'account', tag: 'start', emoji: '👤', q: t('faq.items.account.q'), a: t('faq.items.account.a') },
  { id: 'password', tag: 'start', emoji: '🔑', q: t('faq.items.password.q'), a: t('faq.items.password.a') },
  { id: 'sync', tag: 'saving', emoji: '☁️', q: t('faq.items.sync.q'), a: t('faq.items.sync.a') },
  { id: 'extension', tag: 'saving', emoji: '🧩', q: t('faq.items.extension.q'), a: t('faq.items.extension.a') },
  { id: 'bad-save', tag: 'saving', emoji: '🖼️', q: t('faq.items.bad_save.q'), a: t('faq.items.bad_save.a') },
  { id: 'export', tag: 'saving', emoji: '📦', q: t('faq.items.export.q'), a: t('faq.items.export.a') },
  { id: 'pricing', tag: 'billing', emoji: '💳', q: t('faq.items.pricing.q'), a: t('faq.items.pricing.a') },
  { id: 'cancel', tag: 'billing', emoji: '🔁', q: t('faq.items.cancel.q'), a: t('faq.items.cancel.a') },
  { id: 'privacy', tag: 'privacy', emoji: '🔒', q: t('faq.items.privacy.q'), a: t('faq.items.privacy.a') },
  { id: 'delete', tag: 'privacy', emoji: '🗑️', q: t('faq.items.delete.q'), a: t('faq.items.delete.a') },
  { id: 'api', tag: 'dev', emoji: '🛠️', q: t('faq.items.api.q'), a: t('faq.items.api.a') },
])

const active = ref('all')
const opened = ref(null)
const visible = computed(() => active.value === 'all' ? faqs.value : faqs.value.filter(f => f.tag === active.value))
const count = id => id === 'all' ? faqs.value.length : faqs.value.filter(f => f.tag === id).length

// /faq#sync opens that bite; Nuxt's hash scroll lands on it.
onMounted(() => {
  const id = location.hash.slice(1)
  if (faqs.value.some(f => f.id === id)) opened.value = id
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.faq-page {
  @apply bg-neutral-800 min-h-screen text-white relative;
}

.faq-hero {
  @apply text-center px-4 pt-20 pb-12 md:pt-28 md:pb-16 relative z-[1];
}

.faq-title {
  @apply text-5xl md:text-7xl font-black leading-[0.95] tracking-tight mb-6;
}

.faq-body {
  @apply relative z-[1] max-w-5xl w-[90%] mx-auto grid gap-6 md:gap-10 md:grid-cols-[13rem_1fr] items-start;
}

/* Topic rail: a horizontal strip on phones, a sticky column beside the list on desktop. */
.faq-topics {
  @apply flex gap-2 overflow-x-auto pb-2 -mx-2 px-2 md:mx-0 md:px-0 md:pb-0 md:flex-col md:sticky md:top-24;
  scrollbar-width: none;
}
.faq-topics::-webkit-scrollbar { display: none; }

.faq-chip {
  @apply flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-700 bg-neutral-800/70 px-3 py-1.5 text-sm font-semibold text-gray-300 transition cursor-pointer;
  @apply hover:border-neutral-500 hover:text-white;
  @apply focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}
.faq-chip.active {
  @apply border-green-400/60 text-white;
  background: linear-gradient(90deg, rgba(134, 239, 172, 0.18), rgba(34, 197, 94, 0.18));
  box-shadow: 0 0 24px rgba(65, 217, 118, 0.18);
}
.faq-chip-emoji { @apply text-base leading-none; }
.faq-chip-count {
  @apply ml-auto text-xs font-medium text-gray-500 tabular-nums pl-2;
}
.faq-chip.active .faq-chip-count { @apply text-green-300; }

.faq-list { @apply flex flex-col gap-3; }

/* One saved answer. Opening it lights up like the landing page spotlight cards. */
.faq-bite {
  @apply rounded-2xl border border-neutral-700 bg-neutral-800 shadow-lg transition-[border-color,box-shadow] duration-300;
  scroll-margin-top: 6rem;
}
.faq-bite[open] {
  border-color: rgba(65, 217, 118, 0.5);
  box-shadow: 0 0 0 1px rgba(65, 217, 118, 0.15), 0 20px 50px rgba(0, 0, 0, 0.45), 0 0 60px rgba(65, 217, 118, 0.12);
}
.faq-bite summary {
  @apply flex items-center gap-4 px-5 py-4 md:px-6 md:py-5 cursor-pointer list-none select-none rounded-2xl;
  @apply focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400;
}
.faq-bite summary::-webkit-details-marker { display: none; }
.faq-bite-emoji { @apply text-2xl leading-none shrink-0; }
.faq-bite-q { @apply text-lg md:text-xl font-bold leading-snug flex-1; }

/* Plus that turns into a minus. */
.faq-bite-plus {
  @apply relative w-5 h-5 shrink-0 text-gray-500 transition-transform duration-300;
}
.faq-bite-plus::before,
.faq-bite-plus::after {
  content: '';
  @apply absolute bg-current rounded-full left-1/2 top-1/2;
  width: 14px; height: 2px;
  transform: translate(-50%, -50%);
}
.faq-bite-plus::after { transform: translate(-50%, -50%) rotate(90deg); }
.faq-bite[open] .faq-bite-plus { @apply text-green-300 rotate-45; }

.faq-bite-a {
  @apply px-5 pb-5 md:px-6 md:pb-6 pl-[3.75rem] md:pl-[4.25rem] text-gray-400 text-base md:text-lg leading-relaxed max-w-prose;
}
.faq-bite-a :deep(a) {
  @apply text-green-300 underline underline-offset-4 decoration-green-300/40 hover:decoration-green-300;
}

@media (prefers-reduced-motion: reduce) {
  .faq-bite, .faq-bite-plus, .faq-chip { transition: none; }
  .text-shadow-green { animation: none; }
}
</style>
