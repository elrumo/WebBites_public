<template>
  <div class="flex flex-col gap-6 w-full max-w-3xl mx-auto">
    <p class="text-sm opacity-70">
      The services your installation connects to. Anything set in the server's environment (<code>.env</code>) is
      locked here; everything else is saved in the database and used instead of the defaults.
    </p>

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-heroicons-exclamation-triangle" :title="loadError" />

    <UAlert
      v-if="data && !data.encryptionConfigured"
      color="warning" variant="soft" icon="i-heroicons-lock-closed"
      title="Passwords and keys can't be saved yet"
      description="SETTINGS_ENCRYPTION_KEY is not set on the server. Add it to .env (the installer does this for you) and restart."
    />

    <UAlert
      v-if="data?.problems?.length"
      color="warning" variant="soft" icon="i-heroicons-exclamation-triangle"
      title="Some saved settings could not be read"
      :description="data.problems.map(p => `${p.key}: ${p.reason}`).join('; ')"
    />

    <!-- Parse fell back to older settings -->
    <UAlert
      v-if="status?.parse?.usedLastGood"
      color="warning" variant="soft" icon="i-heroicons-arrow-uturn-left"
      title="Parse is running on the previous settings"
      :description="status.parse.lastError || 'Starting with the saved settings did not work.'"
    >
      <template #actions>
        <UButton size="xs" color="neutral" variant="outline" :loading="restarting" @click="restart({ parse: true, retry: true })">
          Try the saved settings again
        </UButton>
      </template>
    </UAlert>

    <!-- Waiting for a restart -->
    <UAlert
      v-if="pending.parse || pending.api"
      color="info" variant="soft" icon="i-heroicons-arrow-path"
      title="Restart to apply your changes"
      :description="pendingText"
    >
      <template #actions>
        <UButton size="xs" color="primary" :loading="restarting" @click="restart({ parse: pending.parse, api: pending.api })">
          Restart {{ pendingWho }}
        </UButton>
      </template>
    </UAlert>
    <p v-if="restartNote" class="text-sm" :class="restartNote.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'">{{ restartNote.text }}</p>

    <div v-if="loading && !data" class="text-sm opacity-60">Loading…</div>

    <section
      v-for="group in groups" :key="group.id"
      class="flex flex-col gap-4 rounded-xl border border-gray-200 dark:border-neutral-700 p-5"
    >
      <header class="flex flex-col gap-1">
        <h2 class="text-base font-semibold">{{ group.title }}</h2>
        <p class="text-sm opacity-70">{{ group.description }}</p>
        <p v-if="group.warning" class="text-xs text-amber-700 dark:text-amber-400">{{ group.warning }}</p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2">
        <div v-for="field in visibleFields(group)" :key="field.key" class="flex flex-col gap-1" :class="field.kind === 'url' || field.key === 'MAIL_FROM' ? 'sm:col-span-2' : ''">
          <label :for="`s-${field.key}`" class="text-sm font-medium flex items-center gap-2">
            {{ field.label }}
            <UBadge v-if="field.locked" color="neutral" variant="soft" size="sm">Set by the environment</UBadge>
            <UBadge v-else-if="field.stored" color="success" variant="soft" size="sm">Saved</UBadge>
          </label>

          <select
            v-if="field.kind === 'select'"
            :id="`s-${field.key}`" v-model="form[field.key]" :disabled="field.locked"
            class="h-9 rounded-md border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 text-sm disabled:opacity-60"
          >
            <option value="">Default</option>
            <option v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>

          <UInput
            v-else
            :id="`s-${field.key}`"
            v-model="form[field.key]"
            :type="field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : 'text'"
            :disabled="field.locked || (field.kind === 'secret' && !data.encryptionConfigured)"
            :placeholder="field.kind === 'secret' && field.isSet ? '•••••••• (set, type to replace)' : field.placeholder"
            :autocomplete="field.kind === 'secret' ? 'new-password' : 'off'"
          />

          <p v-if="errors[field.key]" class="text-xs text-red-600">{{ errors[field.key] }}</p>
          <p v-else-if="field.help" class="text-xs opacity-60">{{ field.help }}</p>
          <button
            v-if="field.kind === 'secret' && field.stored && !field.locked"
            type="button" class="text-xs underline self-start opacity-70" @click="removeSecret(field.key)"
          >
            Remove the saved value
          </button>
        </div>
      </div>

      <footer class="flex flex-wrap items-center gap-2">
        <UButton size="sm" color="primary" :loading="saving === group.id" :disabled="!!saving || !groupDirty(group)" @click="save(group)">
          Save
        </UButton>
        <UButton v-if="group.testable" size="sm" color="neutral" variant="outline" :loading="testing === group.id" :disabled="!!testing" @click="runTest(group)">
          Test connection
        </UButton>
        <UButton v-if="group.id === 'mail'" size="sm" color="neutral" variant="ghost" :loading="testing === 'mail-send'" :disabled="!!testing" @click="runTest(group, true)">
          Send me a test email
        </UButton>
        <span v-if="notes[group.id]" class="text-sm" :class="notes[group.id].ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'">
          {{ notes[group.id].text }}
        </span>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'

const data = ref(null)
const status = ref(null)
const loading = ref(false)
const loadError = ref('')
const form = reactive({})
const initial = reactive({})
const errors = reactive({})
const notes = reactive({})
const saving = ref(null)
const testing = ref(null)
const restarting = ref(false)
const restartNote = ref(null)
const pending = reactive({ parse: false, api: false })
const removed = reactive({})

const STORAGE_KEY = 'wb-settings-pending-restart'

const groups = computed(() => data.value?.groups ?? [])
const fieldsOf = (group) => (data.value?.fields ?? []).filter(f => f.group === group.id)

// Fields that only matter for the chosen provider are hidden until it is chosen.
const visibleFields = (group) => fieldsOf(group).filter((f) => {
  if (group.id === 'mail') {
    const provider = form.MAIL_PROVIDER || (data.value.fields.find(x => x.key === 'MAIL_PROVIDER')?.value) || ''
    if (f.key.startsWith('SMTP_')) return provider === 'smtp' || provider === ''
    if (f.key.startsWith('MAILGUN_')) return provider === 'mailgun'
  }
  if (group.id === 'storage' && f.key !== 'FILES_DRIVER') {
    const driver = form.FILES_DRIVER || (data.value.fields.find(x => x.key === 'FILES_DRIVER')?.value) || ''
    return driver === 's3' || (driver === '' && Boolean(form.S3_BUCKET))
  }
  return true
})

const dirtyKeys = (group) => fieldsOf(group)
  .filter(f => !f.locked)
  .filter(f => removed[f.key] || (form[f.key] ?? '') !== (initial[f.key] ?? ''))
  .map(f => f.key)
const groupDirty = (group) => dirtyKeys(group).length > 0

const pendingWho = computed(() => [pending.parse && 'Parse', pending.api && 'the API'].filter(Boolean).join(' and '))
const pendingText = computed(() => {
  const parts = []
  if (pending.parse) parts.push('Parse reads these at start-up and will be unavailable for a few seconds while it restarts')
  if (pending.api) parts.push('the API picks these up only when it restarts')
  return parts.join('; ') + '.'
})

// The proxy forwards the API's error body as `data`, which itself carries our `data` (errors, locked).
const detail = (e) => e?.data?.data?.errors || e?.data?.data?.locked ? e.data.data : (e?.data?.data?.data ?? {})
const errMessage = (e, fallback) => detail(e).errors ? 'Some values are not valid.' : (e?.data?.statusMessage || e?.statusMessage || e?.message || fallback)

function hydrate() {
  for (const f of data.value.fields) {
    const value = f.kind === 'secret' ? '' : (f.value ?? '')
    form[f.key] = value
    initial[f.key] = value
    removed[f.key] = false
  }
}

async function load() {
  loading.value = true
  try {
    data.value = await $fetch('/api/v1/admin/settings')
    hydrate()
    loadError.value = ''
  } catch (e) {
    loadError.value = errMessage(e, 'Could not load the settings')
  } finally {
    loading.value = false
  }
}

async function refreshStatus() {
  try { status.value = await $fetch('/api/v1/admin/settings/status') } catch { status.value = null }
}

function removeSecret(key) {
  removed[key] = true
  form[key] = ''
}

async function save(group) {
  const keys = dirtyKeys(group)
  const values = {}
  for (const key of keys) values[key] = removed[key] ? null : form[key]
  Object.keys(errors).forEach(k => delete errors[k])
  notes[group.id] = null
  saving.value = group.id
  try {
    const result = await $fetch('/api/v1/admin/settings', { method: 'PUT', body: { values } })
    pending.parse ||= result.restart.parse
    pending.api ||= result.restart.api
    persistPending()
    notes[group.id] = { ok: true, text: result.changed.length ? 'Saved.' : 'Nothing changed.' }
    await load()
  } catch (e) {
    Object.assign(errors, detail(e).errors ?? {})
    notes[group.id] = { ok: false, text: detail(e).locked ? `Set by the environment: ${detail(e).locked.join(', ')}` : errMessage(e, 'Could not save') }
  } finally {
    saving.value = null
  }
}

async function runTest(group, sendMail = false) {
  testing.value = sendMail ? 'mail-send' : group.id
  notes[group.id] = null
  const values = {}
  for (const f of fieldsOf(group)) {
    if (!f.locked && (form[f.key] ?? '') !== '') values[f.key] = form[f.key]
  }
  try {
    const result = await $fetch(`/api/v1/admin/settings/test/${group.id}`, {
      method: 'POST',
      body: { values, ...(sendMail ? { sendTo: 'me' } : {}) },
    })
    notes[group.id] = { ok: result.ok, text: result.message }
  } catch (e) {
    notes[group.id] = { ok: false, text: errMessage(e, 'The test could not run') }
  } finally {
    testing.value = null
  }
}

function persistPending() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ parse: pending.parse, api: pending.api })) } catch { /* private mode */ }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// Ask for the restart, then watch the services go away and come back.
async function restart({ parse = false, api = false, retry = false }) {
  restarting.value = true
  restartNote.value = null
  try {
    await $fetch('/api/v1/admin/settings/apply', { method: 'POST', body: { parse, api, retry } })
  } catch (e) {
    restarting.value = false
    restartNote.value = { ok: false, text: errMessage(e, 'Could not ask for a restart') }
    return
  }

  let sawDown = false
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await wait(2000)
    let s = null
    try { s = await $fetch('/api/v1/admin/settings/status') } catch { s = null }
    const up = s && (!parse || s.parse.up) && (!api || true)
    if (!up) { sawDown = true; continue }
    // up again; if we never saw it go down, give a very quick restart one more look
    if (!sawDown && Date.now() < deadline - 80_000) continue
    status.value = s
    pending.parse = false
    pending.api = false
    persistPending()
    restartNote.value = s.parse?.usedLastGood
      ? { ok: false, text: 'Parse is back, but on the previous settings: the new ones did not work.' }
      : { ok: true, text: 'Everything is back up with the new settings.' }
    restarting.value = false
    await load()
    return
  }
  restarting.value = false
  restartNote.value = { ok: false, text: 'Still waiting after 90 seconds. Check the containers with "docker compose ps" and "docker compose logs parse api".' }
}

onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved) { pending.parse = !!saved.parse; pending.api = !!saved.api }
  } catch { /* nothing remembered */ }
  await Promise.all([load(), refreshStatus()])
})
</script>
