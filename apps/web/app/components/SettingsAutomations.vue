<template>
  <div class="flex flex-col gap-4">
    <AutomationEditor
      v-if="editing"
      :key="editing.id || 'new'"
      :automation="editing.id ? editing : null"
      @close="editing = null"
      @saved="onSaved"
      @deleted="onDeleted"
    />

    <template v-else>
      <UButton icon="i-lucide-plus" size="sm" class="w-fit" @click="editing = { name: '' } as Automation">
        {{ $t('automations.new') }}
      </UButton>

      <div v-if="loading" class="flex flex-col gap-2">
        <USkeleton v-for="n in 3" :key="n" class="h-14 rounded-xl" />
      </div>

      <div v-else-if="!automations.length" class="text-sm text-muted px-1">
        {{ $t('automations.empty') }}
      </div>

      <div v-else class="flex flex-col rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700/70">
        <div
          v-for="(automation, index) in automations"
          :key="automation.id"
          class="flex items-center gap-3 px-4 py-3"
          :class="{ 'border-t border-neutral-200 dark:border-neutral-700/70': index > 0 }"
        >
          <button
            type="button"
            class="flex flex-col min-w-0 flex-1 text-left rounded-md -m-1 p-1 hover:bg-neutral-100/70 dark:hover:bg-neutral-700/40 focus-visible:outline-2 focus-visible:outline-primary"
            @click="editing = automation"
          >
            <span class="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
              <span class="truncate">{{ automation.name }}</span>
              <UBadge v-if="automation.boardId" size="sm" variant="soft" color="neutral" :label="$t('automations.smart_board')" />
            </span>
            <span class="text-xs text-muted truncate">{{ describe(automation) }}</span>
          </button>
          <USwitch
            :model-value="automation.enabled"
            size="sm"
            :aria-label="$t('automations.enable_named', { name: automation.name })"
            @update:model-value="toggle(automation, $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import type { Automation } from '~/composables/useAutomations'

const { t } = useI18n()
const store = useStore()
const { boards, automationToEdit } = storeToRefs(store)
const { fetchAutomations, setAutomationEnabled } = useAutomations()

const automations = ref<Automation[]>([])
const loading = ref(true)
const editing = ref<Automation | null>(null)

function describe(a: Automation) {
  const boardName = (id?: string) => boards.value?.find((b: any) => b.id === id)?.name || t('automations.describe.a_board')
  const conditions = a.conditions.map(c =>
    c.field === 'ai_topic'
      ? t('automations.describe.about', { topics: c.topics?.join(', ') })
      : t('automations.describe.condition', { field: t(`automations.fields.${c.field}`), op: t(`automations.ops.${c.op}`), value: c.value }),
  )
  const actions = a.actions.map(x =>
    x.type === 'add_tag' ? t('automations.describe.tag', { tag: x.tag })
      : x.type === 'add_to_board' ? t('automations.describe.add_to_board', { board: boardName(x.boardId) })
        : x.type === 'read_later' ? t('automations.describe.read_later')
          : t('automations.describe.webhook'),
  )
  const when = conditions.length
    ? conditions.join(t(a.match === 'any' ? 'automations.describe.joiner_any' : 'automations.describe.joiner_all'))
    : t('automations.describe.every_bookmark')
  return t('automations.describe.summary', { when, actions: actions.join(', ') })
}

async function load() {
  loading.value = true
  try {
    automations.value = (await fetchAutomations()).automations
  } catch {
    store.showAlert({ message: t('automations.load_failed'), type: 'danger' })
  } finally {
    loading.value = false
  }
  // Opened from a board's "Edit as automation".
  if (automationToEdit.value) {
    editing.value = automations.value.find(a => a.boardId === automationToEdit.value) || null
    automationToEdit.value = null
  }
}

async function toggle(automation: Automation, enabled: boolean) {
  automation.enabled = enabled
  try {
    await setAutomationEnabled(automation.id!, enabled)
    if (automation.boardId) store.fetchBoards()
  } catch {
    automation.enabled = !enabled
    store.showAlert({ message: t('automations.update_failed'), type: 'danger' })
  }
}

function onSaved(saved: Automation) {
  const i = automations.value.findIndex(a => a.id === saved.id)
  if (i === -1) automations.value.push(saved)
  else automations.value[i] = saved
  editing.value = null
}

function onDeleted(id: string) {
  automations.value = automations.value.filter(a => a.id !== id)
  editing.value = null
}

onMounted(load)
</script>
