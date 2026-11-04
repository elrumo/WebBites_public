<template>
  <div>
    <LandingNavBar :isLandingPage="false" />

    <div class="legal max-w-screen-md mx-auto p-4 pb-24 flex flex-col gap-2">
      <header class="flex flex-col items-center gap-2 py-10 text-center">
        <h1 class="font-semibold text-3xl">{{ title }}</h1>
        <p v-if="subtitle" class="opacity-70 max-w-lg">{{ subtitle }}</p>
        <p v-if="updated" class="text-sm opacity-50">{{ $t('help_pages.legal.last_updated', { date: updated }) }}</p>
      </header>

      <slot />

      <i18n-t keypath="help_pages.legal.questions" tag="p" class="mt-10 text-sm opacity-60">
        <template #email>
          <a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a>
        </template>
      </i18n-t>
    </div>
  </div>
</template>

<script setup>
import { usePreferredDark } from '@vueuse/core'
import { LEGAL } from '~/utils/legal'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  updated: { type: String, default: () => LEGAL.updated },
})

useHead({ title: `WebBites - ${props.title}` })
</script>

<!-- Not scoped: the prose it styles is slotted in, so it carries the parent
     page's scope id and a scoped rule here would never reach it. -->
<style>
@reference "../assets/css/tailwind.css";

.legal { @apply text-[15px] leading-relaxed; }
.legal section { @apply flex flex-col gap-2; }
.legal h2 { @apply text-xl font-semibold mt-8; }
.legal h3 { @apply text-base font-semibold mt-4; }
.legal p, .legal li { @apply opacity-80; }
.legal ul { @apply list-disc pl-5 flex flex-col gap-1; }
.legal ol { @apply list-decimal pl-5 flex flex-col gap-1; }
.legal a { @apply underline underline-offset-2; }
.legal strong { @apply font-semibold opacity-100; }
.legal .table-wrap { @apply overflow-x-auto; }
.legal table { @apply w-full text-left text-sm; }
.legal th, .legal td { @apply py-2 pr-4 align-top border-b border-neutral-200 dark:border-neutral-800; }
.legal th { @apply font-medium opacity-70 whitespace-nowrap; }
.legal .well { @apply flex flex-col gap-2; }
</style>
