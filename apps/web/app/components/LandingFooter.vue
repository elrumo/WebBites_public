<template>
  <footer class="relative z-10 border-t border-white/10 bg-neutral-900">
    <div
      class="mx-auto grid w-[90%] max-w-5xl grid-cols-2 gap-x-8 gap-y-12 py-16 md:grid-cols-[1.5fr_1fr_1fr_1fr]"
    >
      <!-- Brand -->
      <div class="col-span-2 flex flex-col gap-4 md:col-span-1">
        <NuxtLink to="/" class="w-fit text-white">
          <Logo image-size="sm" :is-image="true" class="text-2xl" />
        </NuxtLink>

        <!-- Divs, not <p>/<h2>: main.css sets `h1-h6, p { color: var(--text-color) }`
             unlayered, which outranks Tailwind's utility layer and repaints them. -->
        <div class="flex flex-col gap-1 text-[15px] text-neutral-400">
          <div>&copy; {{ $t('footer.copyright', { year }) }}</div>
          <div>
            {{ $t('footer.made_by') }}
            <a
              href="https://twitter.com/elrumo"
              target="_blank"
              rel="noopener"
              class="font-semibold text-neutral-200 transition-colors hover:text-primary-400"
            >
              Elias
            </a>
          </div>
        </div>

        <div class="flex gap-5 text-[15px] text-neutral-300">
          <NuxtLink to="/privacy" class="transition-colors hover:text-primary-400">
            {{ $t('footer.privacy') }}
          </NuxtLink>
          <NuxtLink to="/tos" class="transition-colors hover:text-primary-400">
            {{ $t('footer.terms') }}
          </NuxtLink>
        </div>
      </div>

      <!-- Link columns -->
      <nav
        v-for="column in columns"
        :key="column.title"
        class="flex flex-col gap-4"
        :aria-label="column.title"
      >
        <div class="text-[11px] font-semibold text-neutral-400">
          {{ column.title }}
        </div>

        <ul class="flex flex-col gap-3">
          <li v-for="link in column.links" :key="link.label">
            <a
              v-if="link.external"
              :href="link.to"
              target="_blank"
              rel="noopener"
              class="text-[15px] text-neutral-300 transition-colors hover:text-primary-400"
            >
              {{ link.label }}
            </a>
            <NuxtLink
              v-else
              :to="link.to"
              class="text-[15px] text-neutral-300 transition-colors hover:text-primary-400"
            >
              {{ link.label }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
</template>

<script setup>
const { t } = useI18n()

const year = new Date().getFullYear()

const EXTENSION_URL =
  'https://chromewebstore.google.com/detail/webbites-browser-extensio/kphdbcjcdhecefloameedhhldchhbela'

const columns = computed(() => [
  {
    title: t('footer.product'),
    links: [
      { label: t('footer.pricing'), to: '/#pricing' },
      { label: t('footer.extension'), to: EXTENSION_URL, external: true },
      { label: t('footer.export'), to: '/export-bookmarks' },
      { label: t('navigation.developers'), to: '/developers' },
      { label: t('landing_footer.api_docs'), to: '/developers/docs' },
    ],
  },
  {
    title: t('footer.support'),
    links: [
      { label: t('footer.help'), to: '/support' },
      { label: t('footer.feedback'), to: '/feedback' },
    ],
  },
  {
    title: t('footer.updates'),
    links: [
      { label: 'X', to: 'https://twitter.com/elrumo', external: true },
      { label: t('footer.changelog'), to: '/changes' },
    ],
  },
])
</script>
