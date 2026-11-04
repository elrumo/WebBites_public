<template>
  <div class="flex flex-col gap-4">
    <!-- The one thing every client needs -->
    <div class="flex flex-col gap-2">
      <div :class="card">
        <div :class="rowStack">
          <span class="flex flex-col min-w-0">
            <span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ $t('settings.assistants.server_url') }}</span>
            <code class="text-xs font-mono text-neutral-600 dark:text-neutral-300 break-all">{{ MCP_URL }}</code>
          </span>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-heroicons-clipboard-document"
            class="w-fit"
            @click="store.copyToClipboard(MCP_URL)"
          >
            {{ $t('settings.assistants.copy') }}
          </UButton>
        </div>
      </div>
      <p class="text-xs text-muted px-1 m-0">{{ $t('settings.assistants.server_url_hint') }}</p>
    </div>

    <!-- Per-client steps. The commands and file names are the same in every
         language, so only the prose around them is translated. -->
    <div class="flex flex-col gap-2">
      <span class="text-sm font-medium px-1">{{ $t('settings.assistants.setup_title') }}</span>
      <div :class="card">
        <UAccordion
          :items="clientItems"
          :ui="{
            item: 'border-b border-neutral-200 dark:border-neutral-700/70 last:border-b-0',
            trigger: 'px-4 py-3 text-sm font-medium text-neutral-800 dark:text-neutral-100 cursor-pointer',
            body: 'px-4 pb-4 pt-0'
          }"
        >
          <template #body="{ item }">
            <ol class="flex flex-col gap-3 list-decimal pl-5 m-0 text-sm text-neutral-700 dark:text-neutral-300">
              <li v-for="step in item.client.steps" :key="step.key" class="pl-1">
                {{ $t(`settings.assistants.clients.${item.client.id}.${step.key}`, { path: item.client.path, file: item.client.file }) }}

                <div v-for="snippet in step.snippets || []" :key="snippet.label" class="mt-2 rounded-lg border border-neutral-200 dark:border-neutral-700/70 bg-neutral-50 dark:bg-neutral-900/50">
                  <div class="flex flex-row items-center justify-between gap-2 pl-3 pr-1 py-1 border-b border-neutral-200 dark:border-neutral-700/70">
                    <span class="text-xs font-mono text-muted truncate">{{ snippet.label }}</span>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-heroicons-clipboard-document"
                      :aria-label="$t('settings.assistants.copy')"
                      @click="store.copyToClipboard(snippet.code)"
                    />
                  </div>
                  <pre class="m-0 px-3 py-2 overflow-x-auto text-xs leading-relaxed"><code class="font-mono text-neutral-800 dark:text-neutral-200">{{ snippet.code }}</code></pre>
                </div>
              </li>
            </ol>
          </template>
        </UAccordion>
      </div>
    </div>

    <!-- Who already has access -->
    <div class="flex flex-col gap-2">
      <span class="text-sm font-medium px-1">{{ $t('settings.assistants.connected_title') }}</span>

      <div v-if="loading && !loaded" class="flex flex-col gap-2">
        <USkeleton v-for="n in 2" :key="n" class="h-14 rounded-xl" />
      </div>

      <div v-else-if="!grants.length" class="text-sm text-muted px-1">
        {{ $t('settings.assistants.connected_empty') }}
      </div>

      <div v-else :class="card">
        <div
          v-for="(grant, index) in grants"
          :key="grant.id"
          :class="[rowStack, { [divider]: index > 0 }]"
        >
          <span class="flex flex-col min-w-0 gap-0.5">
            <span class="flex flex-row flex-wrap items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
              <span class="truncate">{{ grant.clientName }}</span>
              <UBadge v-if="!grant.verified" size="sm" variant="soft" color="warning" :label="$t('settings.assistants.unverified')" />
              <UBadge
                size="sm"
                variant="soft"
                color="neutral"
                :label="canWrite(grant) ? $t('settings.assistants.read_write') : $t('settings.assistants.read_only')"
              />
            </span>
            <span class="text-xs text-muted">
              {{ $t('settings.assistants.connected_on', { date: formatDate(grant.createdAt) }) }}
              ·
              {{ grant.lastUsedAt ? $t('settings.assistants.last_used', { date: formatDate(grant.lastUsedAt) }) : $t('settings.assistants.never_used') }}
            </span>
            <span v-if="confirming === grant.id" class="text-xs text-red-600 dark:text-red-400 mt-1">
              {{ $t('settings.assistants.disconnect_confirm', { name: grant.clientName }) }}
            </span>
          </span>

          <span v-if="confirming === grant.id" class="flex flex-row gap-2 shrink-0">
            <UButton size="xs" color="neutral" variant="ghost" :disabled="revoking === grant.id" @click="confirming = ''">
              {{ $t('common.cancel') }}
            </UButton>
            <UButton size="xs" color="error" :loading="revoking === grant.id" @click="revoke(grant)">
              {{ $t('settings.assistants.disconnect') }}
            </UButton>
          </span>
          <UButton
            v-else
            size="xs"
            color="error"
            variant="soft"
            class="w-fit shrink-0"
            :disabled="!!revoking"
            @click="confirming = grant.id"
          >
            {{ $t('settings.assistants.disconnect') }}
          </UButton>
        </div>
      </div>
    </div>

    <p class="text-xs text-muted px-1 m-0">{{ $t('settings.assistants.limits', allowance) }}</p>
    <p class="text-xs text-muted px-1 m-0">{{ $t('settings.assistants.local_hint') }}</p>

    <UButton color="neutral" variant="soft" size="sm" icon="i-heroicons-book-open" class="w-fit" @click="openGuide">
      {{ $t('settings.assistants.docs_link') }}
    </UButton>
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { MCP_URL, RATE_LIMITS } from '~/utils/devApi'
import { MCP_CLIENTS } from '~/utils/mcpClients'

const { t, locale } = useI18n()
const store = useStore()
const { showSettingsModal } = storeToRefs(store)
const { grants, loaded, loading, revoking, loadGrants, revokeGrant, canWrite } = useConnectedApps()

// The settings modal's card styles are scoped to it, so they are spelled out here.
const card = 'flex flex-col rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700/70'
const rowStack = 'flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3'
const divider = 'border-t border-neutral-200 dark:border-neutral-700/70'

// Which grant is asking "are you sure?" right now.
const confirming = ref('')

const clientItems = computed(() => MCP_CLIENTS.map(client => ({
  value: client.id,
  label: client.generic ? t(`settings.assistants.clients.${client.id}.name`) : client.name,
  client,
})))

// Assistants spend the same monthly allowance as the developer API.
const allowance = computed(() => {
  const perMonth = (plan) => (RATE_LIMITS.find(row => row.plan === plan)?.perMonth ?? 0).toLocaleString(locale.value)
  return { free: perMonth('free'), plus: perMonth('plus') }
})

const formatDate = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale.value, { dateStyle: 'medium' })
}

async function revoke(grant) {
  try {
    await revokeGrant(grant.id)
    confirming.value = ''
    store.showAlert({ message: t('settings.assistants.disconnected', { name: grant.clientName }), type: 'success' })
  } catch {
    store.showAlert({ message: t('settings.assistants.revoke_failed', { name: grant.clientName }), type: 'danger' })
  }
}

const openGuide = () => {
  showSettingsModal.value = false
  navigateTo('/developers/docs/mcp')
}

onMounted(() => {
  loadGrants().catch(() => {
    store.showAlert({ message: t('settings.assistants.load_failed'), type: 'danger' })
  })
})
</script>
