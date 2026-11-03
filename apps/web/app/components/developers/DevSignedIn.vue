<template>
  <ClientOnly>
    <div v-if="currentUser">
      <slot />
    </div>

    <div v-else class="dev-signin">
      <UIcon name="i-heroicons-lock-closed" class="size-5 text-neutral-500" />
      <div class="flex-1">
        <div class="text-sm font-semibold text-white">{{ title }}</div>
        <div class="mt-1 text-sm text-neutral-400">{{ description }}</div>
      </div>
      <UButton to="/login" color="neutral" size="sm" class="font-semibold">Sign in</UButton>
    </div>

    <template #fallback>
      <div class="dev-signin animate-pulse">
        <div class="h-5 w-full rounded bg-white/5" />
      </div>
    </template>
  </ClientOnly>
</template>

<script setup>
import { onMounted } from 'vue'

defineProps({
  title: { type: String, default: 'Sign in to use this' },
  description: { type: String, default: 'Your keys, usage and webhooks live on your account.' },
})

const { currentUser, refreshUser } = useDeveloperAccount()

// Parse only knows who is signed in on the client.
onMounted(refreshUser)
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-signin {
  @apply flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5;
}
</style>
