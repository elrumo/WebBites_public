<template>
  <div class="dev-panel">
    <div class="grid gap-2 sm:grid-cols-2">
      <div class="flex flex-col gap-1.5">
        <label class="dev-label" for="pg-endpoint">Endpoint</label>
        <USelectMenu
          id="pg-endpoint"
          v-model="pg.endpointId"
          :items="ENDPOINTS"
          value-key="id"
          label-key="label"
          class="w-full"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="dev-label" for="pg-key">API key</label>
        <USelectMenu
          v-if="keyItems.length"
          v-model="pg.key"
          :items="keyItems"
          value-key="value"
          label-key="label"
          placeholder="Pick one of your keys"
          class="w-full"
        />
        <UInput id="pg-key" v-model="pg.key" placeholder="…or paste a wb_live_ key" class="w-full" />
      </div>
    </div>

    <div v-if="endpoint.params.length" class="flex flex-col gap-1.5">
      <span class="dev-label">{{ endpoint.method === 'GET' || endpoint.method === 'DELETE' ? 'Parameters' : 'Body' }}</span>
      <div class="grid gap-2 sm:grid-cols-2">
        <UInput
          v-for="p in endpoint.params"
          :key="p.name"
          v-model="pg.values[p.name]"
          :placeholder="`${p.name}${p.required ? ' *' : ''} — ${p.description}`"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <UButton color="primary" class="font-semibold" :loading="loading" :disabled="!pg.key.trim()" @click="run">
        Send request
      </UButton>
      <UBadge :color="methodColor(endpoint.method)" size="sm" class="font-mono">{{ endpoint.method }}</UBadge>
      <code class="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">{{ previewUrl }}</code>
    </div>

    <div v-if="!pg.key.trim()" class="text-xs text-neutral-600">
      Requests go straight from your browser to the API with the key you pick — nothing is stored here.
    </div>

    <div v-if="result" class="flex flex-col gap-2 border-t border-white/10 pt-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="result.status && result.status < 300 ? 'success' : 'error'" size="sm">
          {{ result.status || '—' }} {{ result.statusText }}
        </UBadge>
        <UBadge v-if="result.ms" color="neutral" variant="soft" size="sm">{{ result.ms }} ms</UBadge>
        <UBadge v-for="(v, h) in result.rateHeaders" :key="h" color="neutral" variant="soft" size="sm">
          {{ h }}: {{ v }}
        </UBadge>
      </div>
      <DevCode :code="result.body" language="json" label="Response" />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ENDPOINTS, buildRequest, methodColor } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const { currentUser, keyItems, keys, refreshUser, loadKeys } = useDeveloperAccount()

const pg = reactive({ endpointId: 'listBookmarks', key: '', values: {} })
const result = ref(null)
const loading = ref(false)

const endpoint = computed(() => ENDPOINTS.find(e => e.id === pg.endpointId) || ENDPOINTS[0])

// The playground calls the API directly, exactly as your own code would.
const base = computed(() => `${(useRuntimeConfig().public.backendUrl || '').replace(/\/+$/, '')}/v1/api`)
const previewUrl = computed(() => base.value + buildRequest(endpoint.value, pg.values).path)

// Parameters belong to the endpoint that declared them.
watch(() => pg.endpointId, () => {
  pg.values = {}
  result.value = null
})

const run = async () => {
  loading.value = true
  result.value = null
  const startedAt = performance.now()
  try {
    const ep = endpoint.value
    const { path, body } = buildRequest(ep, pg.values)
    const res = await fetch(base.value + path, {
      method: ep.method,
      headers: {
        Authorization: `Bearer ${pg.key.trim()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let pretty = text
    try { pretty = JSON.stringify(JSON.parse(text), null, 2) } catch { /* not JSON — show it raw */ }

    const rateHeaders = {}
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
      const v = res.headers.get(h)
      if (v) rateHeaders[h] = v
    }

    result.value = {
      status: res.status,
      statusText: res.statusText,
      rateHeaders,
      body: pretty || '(empty body)',
      ms: Math.round(performance.now() - startedAt),
    }
  } catch (e) {
    result.value = {
      status: 0,
      statusText: 'Network error',
      rateHeaders: {},
      body: String(e?.message || e),
      ms: Math.round(performance.now() - startedAt),
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (refreshUser() && !keys.value.length) loadKeys()
})
watch(currentUser, (user) => { if (user && !keys.value.length) loadKeys() })
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-panel { @apply flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5; }
.dev-label { @apply text-xs font-semibold uppercase tracking-wider text-neutral-500; }
</style>
