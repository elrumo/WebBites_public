<template>
  <div class="flex flex-col gap-4">
    <div v-if="loading" class="flex flex-col gap-2">
      <USkeleton v-for="n in 3" :key="n" class="h-14 rounded-xl" />
    </div>

    <template v-else>
      <!-- Not on Plus: say so, but still let an existing setup be switched off or removed. -->
      <div v-if="!features.backups" class="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl bg-primary-50 dark:bg-primary-950/40 px-4 py-3">
        <span class="text-sm flex-1">{{ $t('settings.backups.plus_only') }}</span>
        <UButton size="xs" color="primary" class="w-fit" @click="showSettingsModal = false; showUpgradeModal = true">
          {{ $t('common.upgrade') }}
        </UButton>
      </div>

      <!-- S3 form -->
      <div v-if="showS3Form" :class="card" class="flex flex-col gap-3 p-4">
        <UFormField :label="$t('settings.backups.endpoint')" required>
          <UInput v-model="s3.endpoint" placeholder="https://s3.eu-west-1.amazonaws.com" autocomplete="off" class="w-full" size="sm" />
        </UFormField>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField :label="$t('settings.backups.bucket')" required>
            <UInput v-model="s3.bucket" autocomplete="off" class="w-full" size="sm" />
          </UFormField>
          <UFormField :label="$t('settings.backups.region')">
            <UInput v-model="s3.region" placeholder="us-east-1" autocomplete="off" class="w-full" size="sm" />
          </UFormField>
        </div>
        <UFormField :label="$t('settings.backups.prefix')">
          <UInput v-model="s3.prefix" placeholder="webbites/" autocomplete="off" class="w-full" size="sm" />
        </UFormField>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField :label="$t('settings.backups.access_key')" required>
            <UInput v-model="s3.accessKey" autocomplete="off" class="w-full" size="sm" />
          </UFormField>
          <UFormField :label="$t('settings.backups.secret_key')" required>
            <UInput v-model="s3.secretKey" type="password" autocomplete="new-password" class="w-full" size="sm" />
          </UFormField>
        </div>
        <div class="flex flex-row gap-2 justify-end">
          <UButton size="sm" color="neutral" variant="ghost" @click="showS3Form = false">
            {{ $t('settings.backups.cancel') }}
          </UButton>
          <UButton size="sm" :loading="busy === 's3'" :disabled="!s3.endpoint || !s3.bucket || !s3.accessKey || !s3.secretKey" @click="saveS3">
            {{ $t('settings.backups.connect') }}
          </UButton>
        </div>
      </div>

      <!-- Where to back up -->
      <div v-else-if="features.backups && (!backup || choosing)" class="flex flex-col gap-2">
        <span class="text-sm font-medium px-1">{{ $t('settings.backups.choose_destination') }}</span>
        <div :class="card">
          <button
            v-for="(option, index) in destinations"
            :key="option.id"
            type="button"
            :class="[row, rowButton, { [divider]: index > 0 }]"
            :disabled="!!busy"
            @click="choose(option.id)"
          >
            <span class="flex flex-row items-center gap-3 min-w-0">
              <UIcon :name="option.icon" class="text-xl opacity-70 shrink-0" />
              <span class="flex flex-col min-w-0">
                <span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ option.label }}</span>
                <span class="text-xs text-muted truncate">{{ option.hint }}</span>
              </span>
            </span>
            <UIcon v-if="busy === option.id" name="i-heroicons-arrow-path" class="text-lg opacity-60 animate-spin shrink-0" />
            <UIcon v-else name="i-heroicons-chevron-right" class="text-lg opacity-40 shrink-0" />
          </button>
        </div>
        <UButton v-if="backup" size="xs" color="neutral" variant="ghost" class="w-fit" @click="choosing = false">
          {{ $t('settings.backups.cancel') }}
        </UButton>
      </div>

      <!-- Connected -->
      <template v-if="backup && !choosing && !showS3Form">
        <div
          v-if="problem"
          class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <span class="flex flex-row items-start gap-3 flex-1 min-w-0">
            <UIcon name="i-heroicons-exclamation-triangle" class="text-lg shrink-0" />
            <span class="min-w-0 break-words">{{ problem }}</span>
          </span>
          <UButton v-if="backup.needsReconnect && features.backups" size="xs" color="error" variant="soft" class="w-fit" :loading="busy === backup.destination" @click="choose(backup.destination)">
            {{ $t('settings.backups.reconnect') }}
          </UButton>
        </div>

        <div :class="card">
          <div :class="row">
            <span class="flex flex-row items-center gap-3 min-w-0">
              <UIcon :name="destinationOf(backup.destination).icon" class="text-xl opacity-70 shrink-0" />
              <span class="flex flex-col min-w-0">
                <span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ destinationOf(backup.destination).label }}</span>
                <span v-if="backup.destination === 's3'" class="text-xs text-muted truncate">{{ backup.destinationLabel }}</span>
              </span>
            </span>
            <UButton v-if="features.backups" size="xs" color="neutral" variant="soft" @click="choosing = true">
              {{ $t('settings.backups.change') }}
            </UButton>
          </div>

          <div :class="divider" />

          <div :class="row">
            <span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ $t('settings.backups.enabled') }}</span>
            <USwitch
              :model-value="backup.enabled"
              size="sm"
              :disabled="busy === 'settings' || (!backup.enabled && (!features.backups || backup.needsReconnect))"
              :aria-label="$t('settings.backups.enabled')"
              @update:model-value="update({ enabled: $event })"
            />
          </div>

          <div :class="divider" />

          <div :class="row">
            <span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ $t('settings.backups.frequency') }}</span>
            <USelect
              :model-value="backup.frequency"
              :items="frequencies"
              size="sm"
              class="w-32"
              :disabled="busy === 'settings'"
              @update:model-value="update({ frequency: $event })"
            />
          </div>

          <div :class="divider" />

          <div :class="rowStack">
            <span class="flex flex-col min-w-0">
              <span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">{{ $t('settings.backups.last_backup') }}</span>
              <span class="text-xs text-muted">
                {{ backup.running ? $t('settings.backups.running') : backup.lastSuccessAt ? formatDate(backup.lastSuccessAt) : $t('settings.backups.never') }}
                <template v-if="!backup.running && backup.nextRunAt"> · {{ $t('settings.backups.next_backup', { time: formatDate(backup.nextRunAt) }) }}</template>
              </span>
            </span>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-heroicons-cloud-arrow-up"
              class="w-fit"
              :loading="busy === 'run'"
              :disabled="backup.running || !backup.enabled || !features.backups"
              @click="runNow"
            >
              {{ $t('settings.backups.back_up_now') }}
            </UButton>
          </div>

          <div :class="divider" />

          <button type="button" :class="[row, rowButton]" :disabled="busy === 'disconnect'" @click="disconnect">
            <span class="text-sm font-medium text-red-600 dark:text-red-400">{{ $t('settings.backups.disconnect') }}</span>
            <UIcon name="i-heroicons-x-circle" class="text-lg text-red-500/70" />
          </button>
        </div>
      </template>

      <p class="text-xs text-muted px-1">{{ $t('settings.backups.whats_included') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

type Destination = 's3' | 'gdrive' | 'dropbox'
interface Backup {
  destination: Destination
  destinationLabel: string | null
  enabled: boolean
  frequency: 'daily' | 'weekly'
  running: boolean
  needsReconnect: boolean
  lastError: string | null
  lastSuccessAt: string | null
  nextRunAt: string | null
}

const { t, locale } = useI18n()
const store = useStore()
const { features, showSettingsModal, showUpgradeModal } = storeToRefs(store)
const { backendFetch } = useBackendFetch()

// The settings modal's card styles are scoped to it, so they are spelled out here.
const card = 'flex flex-col rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700/70'
const row = 'flex flex-row items-center justify-between gap-3 px-4 py-3 text-left'
const rowStack = 'flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3'
const rowButton = 'w-full transition-colors duration-150 hover:bg-neutral-100/70 dark:hover:bg-neutral-700/40 first:rounded-t-xl last:rounded-b-xl disabled:opacity-60'
const divider = 'border-t border-neutral-200 dark:border-neutral-700/70'

const backup = ref<Backup | null>(null)
const loading = ref(true)
const choosing = ref(false)
const showS3Form = ref(false)
const busy = ref<string | null>(null)
const s3 = reactive({ endpoint: '', region: '', bucket: '', prefix: '', accessKey: '', secretKey: '' })

const destinations = computed(() => [
  { id: 'gdrive' as const, icon: 'i-tabler-brand-google-drive', label: t('settings.backups.gdrive'), hint: t('settings.backups.gdrive_hint') },
  { id: 'dropbox' as const, icon: 'i-tabler-brand-dropbox', label: t('settings.backups.dropbox'), hint: t('settings.backups.dropbox_hint') },
  { id: 's3' as const, icon: 'i-heroicons-server-stack', label: t('settings.backups.s3'), hint: t('settings.backups.s3_hint') },
])
const destinationOf = (id: Destination) => destinations.value.find(d => d.id === id)!

const frequencies = computed(() => [
  { label: t('settings.backups.daily'), value: 'daily' },
  { label: t('settings.backups.weekly'), value: 'weekly' },
])

const problem = computed(() => {
  const b = backup.value
  if (!b) return null
  const destination = destinationOf(b.destination).label
  if (b.needsReconnect) return t('settings.backups.needs_reconnect', { destination })
  if (b.lastError === 'plan_required') return t('settings.backups.plan_required')
  if (b.lastError) return t('settings.backups.error', { error: b.lastError })
  return null
})

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })

const errorMessage = (error: any, fallback: string) =>
  error?.data?.statusMessage || error?.data?.message || error?.data?.data?.message || fallback

const isUsageError = (error: any) =>
  [error?.data?.data?.errorType, error?.data?.errorType].includes('UsageError')

function fail(error: any, fallback: string) {
  if (isUsageError(error)) {
    showSettingsModal.value = false
    showUpgradeModal.value = true
    return
  }
  store.showAlert({ message: errorMessage(error, fallback), type: 'danger' })
}

async function load() {
  loading.value = true
  try {
    const [response] = await Promise.all([
      backendFetch<{ backup: Backup | null }>('backups'),
      // Entitlements may not have loaded yet, and the upsell must not flash at a Plus user.
      'backups' in features.value ? null : store.fetchEntitlements(),
    ])
    backup.value = response.backup
  } catch {
    store.showAlert({ message: t('settings.backups.load_failed'), type: 'danger' })
  } finally {
    loading.value = false
  }
}

async function choose(destination: Destination) {
  if (destination === 's3') {
    showS3Form.value = true
    return
  }
  busy.value = destination
  try {
    const { authorizeUrl } = await backendFetch<{ authorizeUrl: string }>(`backups/connect/${destination}`, { method: 'POST' })
    window.location.href = authorizeUrl
  } catch (error) {
    busy.value = null
    fail(error, t('settings.backups.connect_failed', { destination: destinationOf(destination).label }))
  }
}

async function saveS3() {
  busy.value = 's3'
  try {
    backup.value = (await backendFetch<{ backup: Backup }>('backups', { method: 'PUT', body: { s3: { ...s3 } } })).backup
    s3.secretKey = ''
    showS3Form.value = false
    choosing.value = false
    store.showAlert({ message: t('settings.backups.connected', { destination: destinationOf('s3').label }), type: 'success' })
  } catch (error) {
    fail(error, t('settings.backups.connect_failed', { destination: destinationOf('s3').label }))
  } finally {
    busy.value = null
  }
}

async function update(changes: Partial<Pick<Backup, 'enabled' | 'frequency'>>) {
  busy.value = 'settings'
  try {
    backup.value = (await backendFetch<{ backup: Backup }>('backups', { method: 'PUT', body: changes })).backup
  } catch (error) {
    fail(error, t('settings.backups.save_failed'))
  } finally {
    busy.value = null
  }
}

async function runNow() {
  busy.value = 'run'
  try {
    backup.value = (await backendFetch<{ backup: Backup }>('backups/run', { method: 'POST' })).backup
    store.showAlert({ message: t('settings.backups.queued'), type: 'success' })
  } catch (error) {
    fail(error, t('settings.backups.run_failed'))
  } finally {
    busy.value = null
  }
}

async function disconnect() {
  busy.value = 'disconnect'
  try {
    await backendFetch('backups', { method: 'DELETE' })
    backup.value = null
  } catch (error) {
    fail(error, t('settings.backups.save_failed'))
  } finally {
    busy.value = null
  }
}

/** Back from Google or Dropbox: `/app?backupConnect=gdrive[&error=denied|failed]`. */
function handleConnectReturn() {
  const url = new URL(window.location.href)
  const provider = url.searchParams.get('backupConnect') as Destination | null
  if (!provider) return
  const destination = destinationOf(provider)?.label || provider
  const error = url.searchParams.get('error')
  if (!error) store.showAlert({ message: t('settings.backups.connected', { destination }), type: 'success' })
  else store.showAlert({ message: t(error === 'denied' ? 'settings.backups.connect_denied' : 'settings.backups.connect_failed', { destination }), type: 'danger' })
  url.searchParams.delete('backupConnect')
  url.searchParams.delete('error')
  window.history.replaceState(window.history.state, '', url)
}

onMounted(() => {
  handleConnectReturn()
  load()
})
</script>
