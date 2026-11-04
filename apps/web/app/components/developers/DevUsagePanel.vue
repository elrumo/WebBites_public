<template>
  <DevSignedIn title="Sign in to see your usage" description="Usage is counted per account, across every key.">
    <div class="dev-panel">
      <template v-if="usage">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Current plan</div>
            <div class="text-lg font-bold capitalize text-white">{{ usage.tier || 'free' }}</div>
          </div>
          <div class="text-right">
            <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500">{{ period }}</div>
            <div class="text-lg font-bold tabular-nums text-white">
              {{ (usage.usage?.total ?? 0).toLocaleString() }}
              <span class="text-sm font-medium text-neutral-500">
                / {{ (usage.limits?.perMonth ?? 0).toLocaleString() }}
              </span>
            </div>
          </div>
        </div>

        <div class="dev-meter" role="progressbar" :aria-valuenow="Math.round(percent)" aria-valuemin="0" aria-valuemax="100">
          <div class="dev-meter-fill" :class="{ hot: percent > 85 }" :style="{ width: `${percent}%` }" />
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="dev-stat">
            <div class="dev-stat-label">Per minute</div>
            <div class="dev-stat-value">{{ (usage.limits?.perMinute ?? 0).toLocaleString() }}</div>
          </div>
          <div class="dev-stat">
            <div class="dev-stat-label">Left this month</div>
            <div class="dev-stat-value">{{ remaining.toLocaleString() }}</div>
          </div>
        </div>

        <div v-if="byKey.length" class="flex flex-col gap-2 border-t border-white/10 pt-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Per key</div>
          <div v-for="row in byKey" :key="row.key" class="flex items-center justify-between gap-3">
            <code class="truncate font-mono text-xs text-neutral-400">{{ keyLabel(row.key) }}</code>
            <span class="shrink-0 text-sm tabular-nums text-neutral-300">{{ row.count.toLocaleString() }}</span>
          </div>
        </div>

        <!-- MCP calls made over an OAuth connection are counted per connection
             (grant), not per key. A grant that has since been disconnected is
             no longer in the list, so it has no name left to show. -->
        <div v-if="byGrant.length" class="flex flex-col gap-2 border-t border-white/10 pt-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Per AI assistant</div>
          <div v-for="row in byGrant" :key="row.id" class="flex items-center justify-between gap-3">
            <span class="truncate text-xs text-neutral-400">{{ grantLabel(row.id) || (grantsLoading ? '…' : 'Disconnected assistant') }}</span>
            <span class="shrink-0 text-sm tabular-nums text-neutral-300">{{ row.count.toLocaleString() }}</span>
          </div>
        </div>

        <div class="flex items-center gap-3 pt-1">
          <UButton size="xs" color="neutral" variant="soft" :loading="loading.usage" @click="loadUsage">
            Refresh
          </UButton>
          <span class="text-xs text-neutral-600">Counts reset on the first of the month.</span>
        </div>
      </template>

      <div v-else class="dev-panel-muted">
        {{ loading.usage ? 'Loading your usage…' : 'No usage recorded yet — make a request and it shows up here.' }}
      </div>
    </div>
  </DevSignedIn>
</template>

<script setup>
import { computed, watch, onMounted } from 'vue'

const { currentUser, usage, loading, refreshUser, loadUsage, keyLabel, keys, loadKeys } = useDeveloperAccount()
const { loaded: grantsLoaded, loading: grantsLoading, loadGrants, grantLabel } = useConnectedApps()

const percent = computed(() => {
  const limit = usage.value?.limits?.perMonth
  return limit ? Math.min(100, ((usage.value.usage?.total ?? 0) / limit) * 100) : 0
})

const remaining = computed(() =>
  Math.max(0, (usage.value?.limits?.perMonth ?? 0) - (usage.value?.usage?.total ?? 0))
)

// `usage.month` is the UTC month being counted, as 'YYYY-MM'; `usage.total` is its count.
const period = computed(() => {
  const [year, month] = String(usage.value?.usage?.month || '').split('-').map(Number)
  return year && month
    ? new Date(Date.UTC(year, month - 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'This month'
})

const byKey = computed(() =>
  Object.entries(usage.value?.usage?.byKey || {}).map(([key, count]) => ({ key, count: Number(count) }))
)

const byGrant = computed(() =>
  Object.entries(usage.value?.usage?.byGrant || {}).map(([id, count]) => ({ id, count: Number(count) }))
)

// Assistants' names come from the connected-apps list, fetched only once there
// is a row to name. Without it the rows still show, as disconnected ones.
watch(() => byGrant.value.length, (rows) => {
  if (rows && !grantsLoaded.value) loadGrants().catch(() => {})
}, { immediate: true })

const load = () => {
  loadUsage()
  // Names come from the key list; without it the breakdown is raw keys.
  if (!keys.value.length) loadKeys()
}

onMounted(() => { if (refreshUser()) load() })
watch(currentUser, (user) => { if (user) load() })
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-panel { @apply flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5; }
.dev-panel-muted { @apply text-sm text-neutral-500; }

.dev-meter { @apply h-2 w-full overflow-hidden rounded-full bg-white/10; }
.dev-meter-fill {
  @apply h-full rounded-full bg-gradient-to-r from-green-300 to-green-500 transition-[width] duration-500;
}
.dev-meter-fill.hot { @apply from-amber-300 to-red-400; }

.dev-stat { @apply rounded-xl border border-white/10 bg-black/20 px-4 py-3; }
.dev-stat-label { @apply text-xs font-semibold uppercase tracking-wider text-neutral-500; }
.dev-stat-value { @apply mt-0.5 text-base font-bold tabular-nums text-white; }
</style>
