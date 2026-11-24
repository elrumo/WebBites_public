<template>
  <div class="flex flex-col gap-4 w-full max-w-3xl mx-auto">
    <p class="text-sm opacity-70">
      Makes Meilisearch match Parse (use it after switching to a new Meilisearch, or to rebuild search from scratch): writes bookmarks that are missing or out of date,
      removes ones Parse no longer has, and backs up the embeddings to Parse (<code>SearchEmbedding</code>).
      A bookmark written to an index that lacks its embedding gets the backup instead of a new embedding call.
      <strong>One way</strong> only writes the indexes from Parse: it still uses the backups, but writes nothing to Parse.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <UButton size="sm" color="neutral" variant="outline" :loading="starting === 'dry'" :disabled="isRunning || !!starting" @click="start(true)">
        Dry run
      </UButton>
      <UButton size="sm" color="primary" :loading="starting === 'real'" :disabled="isRunning || !!starting" @click="start(false)">
        Sync now
      </UButton>
      <UButton size="sm" color="primary" variant="soft" :loading="starting === 'oneWay'" :disabled="isRunning || !!starting" @click="startOneWay">
        One way: Parse → both
      </UButton>
      <UButton v-if="isRunning" size="sm" color="error" variant="soft" :loading="stopping" :disabled="run.cancelRequested" @click="stop">
        {{ run.cancelRequested ? 'Stopping…' : 'Stop run' }}
      </UButton>
      <UButton v-if="run?.canResume && !isRunning" size="sm" color="primary" variant="outline" :loading="starting === 'resume'" :disabled="!!starting" @click="resume">
        Resume from user {{ (summary.usersDone ?? 0) + 1 }}
      </UButton>
      <UButton size="sm" variant="ghost" :loading="loading" @click="load">
        <UIcon name="heroicons:arrow-path-solid" class="w-4 h-4" />
      </UButton>
    </div>

    <form class="flex flex-wrap items-center gap-2" @submit.prevent="startUser">
      <UInput v-model="userInput" size="sm" placeholder="User id or email" class="w-64" :disabled="isRunning" />
      <UButton type="submit" size="sm" color="neutral" variant="outline" :loading="starting === 'user'" :disabled="isRunning || !!starting || !userInput.trim()">
        Sync this user
      </UButton>
    </form>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <p v-if="!run && !loading" class="text-sm opacity-60">No runs yet. Start with a dry run: it counts what would change without writing anything.</p>

    <div v-if="run" class="flex flex-col gap-3 rounded-xl border border-gray-200 dark:border-neutral-700 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :color="badge.color" variant="soft">{{ badge.label }}</UBadge>
        <span class="text-sm font-medium">{{ summary.dryRun ? 'Dry run' : 'Sync' }}</span>
        <span v-if="summary.oneWay" class="text-sm opacity-60">· one way (Parse → Meilisearch)</span>
        <span v-if="summary.userId" class="text-sm opacity-60">· one user ({{ summary.userId }})</span>
        <span v-if="summary.resumedFrom" class="text-sm opacity-60">· resumed at user {{ summary.resumedFrom.atUser + 1 }}</span>
        <span class="text-sm opacity-60">started {{ new Date(run.startedAt).toLocaleString() }}</span>
        <span v-if="run.executionTimeMs" class="text-sm opacity-60">· {{ duration(run.executionTimeMs) }}</span>
      </div>

      <p v-if="run.stale" class="text-sm">
        No progress since {{ new Date(run.updatedAt).toLocaleTimeString() }}: the backend process running it ended (a deploy or a restart).
        Resume it from where it stopped, or start a new run.
      </p>
      <p v-else-if="run.result !== 'running' && run.message" class="text-sm">{{ run.message }}</p>

      <div class="text-sm">
        Users {{ summary.usersDone ?? 0 }} / {{ summary.usersTotal || '…' }}
        <UProgress v-if="isRunning" class="mt-1" :model-value="summary.usersTotal ? (100 * summary.usersDone) / summary.usersTotal : null" />
      </div>

      <table v-if="targets.length" class="w-full text-sm">
        <thead class="text-left opacity-60 border-b border-gray-200 dark:border-neutral-700">
          <tr>
            <th class="py-1 pr-3">Instance</th>
            <th class="py-1 pr-3">{{ verb('Written', 'To write') }}</th>
            <th class="py-1 pr-3">…with backed-up embedding</th>
            <th class="py-1 pr-3">{{ verb('Removed', 'To remove') }}</th>
            <th class="py-1 pr-3">{{ verb('Embeddings backed up', 'To back up') }}</th>
            <th class="py-1 pr-3">Deleted users</th>
            <th class="py-1 pr-3">Failed tasks</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[label, c] in targets" :key="label" class="border-b border-gray-100 dark:border-neutral-800">
            <td class="py-1 pr-3 font-medium">{{ label }}</td>
            <td class="py-1 pr-3">{{ c.written }}</td>
            <td class="py-1 pr-3">{{ c.restored }}</td>
            <td class="py-1 pr-3">{{ c.removed }}</td>
            <td class="py-1 pr-3">{{ c.backedUp }}</td>
            <td class="py-1 pr-3">{{ c.orphanUsers }}</td>
            <td class="py-1 pr-3">{{ c.failedTasks }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="summary.backupsRemoved" class="text-sm opacity-70">
        Backups of deleted bookmarks {{ verb('removed', 'to remove') }}: {{ summary.backupsRemoved }}
      </p>

      <details v-if="summary.errorCount">
        <summary class="text-sm text-red-600 cursor-pointer">{{ summary.errorCount }} errors</summary>
        <ul class="text-xs mt-2 flex flex-col gap-1">
          <li v-for="(e, i) in summary.errors" :key="i">
            <span class="opacity-60">{{ [e.target, e.userId].filter(Boolean).join(' · ') }}</span> {{ e.message }}
          </li>
        </ul>
      </details>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const run = ref(null)
const loading = ref(false)
const starting = ref(null)
const stopping = ref(false)
const userInput = ref('')
const error = ref('')
let timer = null

const summary = computed(() => run.value?.summary ?? {})
// A row that still says "running" but stopped beating is a dead run, not a live one.
const isRunning = computed(() => run.value?.result === 'running' && !run.value?.stale)
const targets = computed(() => Object.entries(summary.value.targets ?? {}))
const badge = computed(() => {
  if (run.value?.stale) return { color: 'warning', label: 'Not responding' }
  if (isRunning.value && run.value?.cancelRequested) return { color: 'warning', label: 'Stopping' }
  return {
    running: { color: 'info', label: 'Running' },
    success: { color: 'success', label: 'Finished' },
    error: { color: 'error', label: 'Failed' },
    cancelled: { color: 'neutral', label: 'Stopped' },
  }[run.value?.result] ?? { color: 'neutral', label: run.value?.result }
})

const verb = (done, planned) => (summary.value.dryRun ? planned : done)
const duration = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`)

const poll = () => {
  clearTimeout(timer)
  if (isRunning.value) timer = setTimeout(load, 5000)
}

const load = async () => {
  loading.value = true
  try {
    run.value = (await $fetch('/api/admin/meilisearchSync')).run
    error.value = ''
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Could not load the last run'
  } finally {
    loading.value = false
    poll()
  }
}

const post = async (kind, body) => {
  starting.value = kind
  try {
    run.value = (await $fetch('/api/admin/meilisearchSync', { method: 'POST', body })).run
    error.value = ''
    poll()
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Could not start the sync'
  } finally {
    starting.value = null
  }
}

const start = (dryRun) => {
  if (!dryRun && !confirm('Write to both Meilisearch instances now? Run a dry run first if you haven\'t.')) return
  return post(dryRun ? 'dry' : 'real', { dryRun })
}

const startOneWay = () => {
  if (!confirm('Write Parse to both Meilisearch instances now, without backing up embeddings to Parse?')) return
  return post('oneWay', { dryRun: false, oneWay: true })
}

// Keeps the stopped run's mode: a dry run resumes as a dry run, a one-way run as one way.
const resume = () => post('resume', { resume: true })

const startUser = () => {
  const user = userInput.value.trim()
  if (!user || !confirm(`Write ${user}'s bookmarks to both Meilisearch instances now?`)) return
  return post('user', { dryRun: false, user })
}

const stop = async () => {
  if (!confirm('Stop the sync? Writes already sent to Meilisearch for the current user are cancelled.')) return
  stopping.value = true
  try {
    run.value = (await $fetch('/api/admin/meilisearchSync', { method: 'DELETE' })).run
    error.value = ''
    poll()
  } catch (e) {
    error.value = e?.data?.statusMessage || e?.message || 'Could not stop the sync'
  } finally {
    stopping.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => clearTimeout(timer))
</script>
