<template>
  <DevSignedIn title="Sign in to manage webhooks" description="Webhooks are registered against your account.">
    <div class="dev-panel">
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput v-model="draft.url" placeholder="https://example.com/webhooks/webbites" class="flex-1" />
        <UInput v-model="draft.description" placeholder="Description (optional)" class="flex-1" />
        <UButton
          color="neutral"
          class="font-semibold"
          :loading="loading.createWebhook"
          :disabled="!draft.url"
          @click="submit"
        >
          Add
        </UButton>
      </div>

      <div v-if="loading.webhooks && !webhooks.length" class="dev-panel-muted">Loading your webhooks…</div>
      <div v-else-if="!webhooks.length" class="dev-panel-muted">
        No webhooks yet. Add one and hit <strong class="text-neutral-300">Test</strong> to see a sample delivery land.
      </div>

      <div v-for="w in webhooks" :key="w.id" class="dev-hook">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold text-white">{{ w.url }}</div>
            <div v-if="w.description" class="truncate text-xs text-neutral-500">{{ w.description }}</div>
          </div>
          <UBadge size="xs" :color="w.active ? 'success' : 'neutral'" variant="soft">
            {{ w.active ? 'active' : 'paused' }}
          </UBadge>
          <UButton size="xs" color="neutral" variant="soft" :loading="loading.test === w.id" @click="testWebhook(w.id)">
            Test
          </UButton>
          <UButton
            size="xs"
            color="error"
            variant="soft"
            icon="i-heroicons-trash"
            aria-label="Delete webhook"
            :loading="loading.deleteWebhook === w.id"
            @click="confirmDelete(w)"
          />
        </div>

        <div class="text-xs text-neutral-500">
          {{ (w.events || []).join(', ') || 'bookmark.saved' }}
          <span v-if="w.lastStatus"> · last status {{ w.lastStatus }}</span>
          <span v-if="w.lastDeliveredAt"> · {{ new Date(w.lastDeliveredAt).toLocaleString() }}</span>
          <span v-if="w.failureCount"> · {{ w.failureCount }} failures</span>
        </div>

        <div v-if="w.secret" class="flex flex-wrap items-center gap-2">
          <code class="break-all font-mono text-xs text-neutral-400">
            {{ revealed.has(w.id) ? w.secret : '•'.repeat(24) }}
          </code>
          <UButton size="xs" color="neutral" variant="ghost" @click="toggle(w.id)">
            {{ revealed.has(w.id) ? 'Hide' : 'Show secret' }}
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-clipboard"
            aria-label="Copy signing secret"
            @click="copy(w.secret)"
          />
        </div>
      </div>
    </div>
  </DevSignedIn>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue'

const {
  currentUser, webhooks, loading, refreshUser,
  loadWebhooks, createWebhook, deleteWebhook, testWebhook, copy,
} = useDeveloperAccount()

const draft = reactive({ url: '', description: '' })
const revealed = ref(new Set())

const submit = async () => {
  if (await createWebhook(draft)) {
    draft.url = ''
    draft.description = ''
  }
}

const confirmDelete = (w) => {
  if (confirm(`Delete the webhook for ${w.url}?`)) deleteWebhook(w.id)
}

// A new Set each time, so the template re-renders on toggle.
const toggle = (id) => {
  const next = new Set(revealed.value)
  next.has(id) ? next.delete(id) : next.add(id)
  revealed.value = next
}

onMounted(() => { if (refreshUser()) loadWebhooks() })
watch(currentUser, (user) => { if (user) loadWebhooks() })
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-panel { @apply flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5; }
.dev-panel-muted { @apply text-sm text-neutral-500; }

.dev-hook { @apply flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3; }
</style>
