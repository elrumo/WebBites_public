<template>
  <DevSignedIn title="Sign in to manage your keys" description="Keys belong to an account, so we need to know whose.">
    <div class="dev-panel">
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput
          v-model="newKeyName"
          placeholder="Key name — e.g. “raycast”, “backup script”"
          class="flex-1"
          @keyup.enter="submit"
        />
        <UButton color="neutral" class="font-semibold" :loading="loading.createKey" @click="submit">
          Create key
        </UButton>
      </div>

      <div v-if="loading.keys && !keys.length" class="dev-panel-muted">Loading your keys…</div>
      <div v-else-if="!keys.length" class="dev-panel-muted">
        No keys yet. Create one above — it works the moment it appears.
      </div>

      <div v-for="k in keys" :key="k.key" class="dev-key">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-white">{{ k.name || 'Untitled key' }}</div>
          <code class="mt-0.5 block break-all font-mono text-xs text-neutral-400">{{ k.key }}</code>
          <div v-if="k.createdAt" class="mt-0.5 text-xs text-neutral-600">
            Created {{ new Date(k.createdAt).toLocaleDateString() }}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-heroicons-clipboard"
            aria-label="Copy key"
            @click="copy(k.key)"
          />
          <UButton
            size="xs"
            color="error"
            variant="soft"
            icon="i-heroicons-trash"
            aria-label="Revoke key"
            :loading="loading.revoke === k.key"
            @click="confirmRevoke(k)"
          />
        </div>
      </div>
    </div>
  </DevSignedIn>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

const { currentUser, keys, loading, refreshUser, loadKeys, createKey, revokeKey, copy } = useDeveloperAccount()

const newKeyName = ref('')

const submit = async () => {
  if (await createKey(newKeyName.value)) newKeyName.value = ''
}

const confirmRevoke = (k) => {
  const label = k.name || 'this key'
  if (confirm(`Revoke ${label}? Anything using it stops working immediately.`)) revokeKey(k.key)
}

onMounted(() => {
  if (refreshUser()) loadKeys()
})
watch(currentUser, (user) => { if (user) loadKeys() })
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-panel { @apply flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5; }
.dev-panel-muted { @apply text-sm text-neutral-500; }

.dev-key {
  @apply flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3;
}
</style>
