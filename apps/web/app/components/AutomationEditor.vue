<template>
  <div class="automation-card">
    <header class="flex items-center gap-3">
      <span class="automation-icon"><UIcon name="i-lucide-workflow" /></span>
      <UInput
        v-model="draft.name"
        :placeholder="$t('automations.name_placeholder')"
        variant="none"
        size="lg"
        class="flex-1 min-w-0"
        :ui="{ base: 'px-0 font-semibold text-base' }"
      />
      <USwitch v-model="draft.enabled" size="sm" :aria-label="$t('automations.enabled')" />
    </header>

    <!-- WHENEVER -->
    <section class="flex flex-col gap-2">
      <h3 class="automation-label">{{ $t('automations.whenever') }}</h3>
      <div class="automation-row !flex-row items-center">
        <UIcon name="i-lucide-bookmark" class="automation-row-icon" />
        <span class="text-sm">{{ $t('automations.trigger_bookmark_added') }}</span>
      </div>
    </section>

    <AutomationConditions
      v-model="draft.conditions"
      v-model:match="draft.match"
      :empty-text="$t('automations.no_conditions')"
    />

    <!-- ACTIONS -->
    <section class="flex flex-col gap-2">
      <h3 class="automation-label">{{ $t('automations.actions') }}</h3>

      <div v-for="(action, i) in draft.actions" :key="i" class="automation-row">
        <div class="flex items-center gap-2">
          <UIcon :name="actionIcon(action.type)" class="automation-row-icon" />
          <USelect
            :model-value="action.type"
            :items="actionOptions"
            size="sm"
            class="w-44"
            @update:model-value="setActionType(action, $event)"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            class="ms-auto"
            :aria-label="$t('automations.remove_action')"
            @click="draft.actions.splice(i, 1)"
          />
        </div>

        <UInput v-if="action.type === 'add_tag'" v-model="action.tag" placeholder="Shopping" size="sm" class="w-full" />
        <USelectMenu
          v-else-if="action.type === 'add_to_board'"
          v-model="action.boardId"
          :items="boardOptions"
          value-key="value"
          :placeholder="$t('automations.choose_board')"
          size="sm"
          class="w-full"
        />
        <template v-else-if="action.type === 'webhook'">
          <UInput v-model="action.url" placeholder="https://hooks.example.com/…" size="sm" class="w-full" :ui="{ base: 'font-mono' }" />
          <UTextarea
            v-model="action.body"
            :placeholder="webhookPlaceholder"
            :rows="3"
            autoresize
            size="sm"
            class="w-full"
            :ui="{ base: 'font-mono text-xs' }"
          />
          <p class="text-xs text-muted m-0">
            <i18n-t keypath="automations.webhook_help" tag="span">
              <template #title><code v-pre>{{title}}</code></template>
              <template #url><code v-pre>{{url}}</code></template>
              <template #type><code v-pre>{{type}}</code></template>
              <template #id><code v-pre>{{id}}</code></template>
              <template #tags><code v-pre>{{tags}}</code></template>
            </i18n-t>
            <i18n-t :keypath="draft.secret ? 'automations.webhook_signed_secret' : 'automations.webhook_signed'" tag="span">
              <template #header><code>X-WebBites-Signature</code></template>
              <template #secret><code class="select-all">{{ draft.secret }}</code></template>
            </i18n-t>
          </p>
        </template>
      </div>

      <button type="button" class="automation-add" @click="draft.actions.push({ type: 'add_tag', tag: '' })">
        <UIcon name="i-lucide-plus" /> {{ $t('automations.add_action') }}
      </button>
    </section>

    <p v-if="draft.boardId" class="text-xs text-muted m-0">
      {{ $t('automations.smart_board_note') }}
    </p>

    <footer class="flex items-center gap-2">
      <UButton
        v-if="draft.id"
        color="error"
        variant="ghost"
        size="sm"
        icon="i-lucide-trash-2"
        :loading="deleting"
        @click="remove"
      >
        {{ $t('common.delete') }}
      </UButton>
      <div class="flex-1" />
      <UButton color="neutral" variant="ghost" size="sm" @click="emit('close')">{{ $t('common.cancel') }}</UButton>
      <UButton size="sm" :loading="saving" :disabled="!canSave" @click="save">{{ $t('common.save') }}</UButton>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import type { Automation, AutomationAction } from '~/composables/useAutomations'

const props = defineProps<{ automation?: Automation | null }>()
const emit = defineEmits<{ close: []; saved: [Automation]; deleted: [string] }>()

const { t } = useI18n()
const store = useStore()
const { plainBoards: boards } = storeToRefs(store)
const { saveAutomation, deleteAutomation } = useAutomations()

const blank = (): Automation => ({
  name: '',
  enabled: true,
  match: 'all',
  conditions: [{ field: 'url', op: 'contains', value: '' }],
  actions: [{ type: 'add_tag', tag: '' }],
})
// Edits happen on a copy so Cancel leaves the list untouched.
const draft = ref<Automation>(structuredClone(toRaw(props.automation) ?? blank()))
const saving = ref(false)
const deleting = ref(false)

const actionOptions = computed(() => [
  { label: t('common.add_tag'), value: 'add_tag' },
  { label: t('automations.action_add_to_board'), value: 'add_to_board' },
  { label: t('automations.action_read_later'), value: 'read_later' },
  { label: t('automations.action_webhook'), value: 'webhook' },
])
const boardOptions = computed(() =>
  (boards.value || []).map((b: any) => ({ label: b.name, value: b.id })),
)
const webhookPlaceholder = '{ "text": "Saved {{title}}: {{url}}" }'

const ACTION_ICONS: Record<string, string> = {
  add_tag: 'i-lucide-tag', add_to_board: 'i-lucide-list', read_later: 'i-lucide-clock', webhook: 'i-lucide-webhook',
}
const actionIcon = (type: string) => ACTION_ICONS[type] || 'i-lucide-zap'
function setActionType(action: AutomationAction, type: AutomationAction['type']) {
  action.type = type
  if (type === 'add_to_board' && !boards.value?.length) store.fetchBoards()
}

const canSave = computed(() => {
  const d = draft.value
  if (!d.name.trim() || !d.actions.length) return false
  const conditionsOk = d.conditions.every(c => (c.field === 'ai_topic' ? c.topics?.length : c.value?.trim()))
  const actionsOk = d.actions.every(a =>
    a.type === 'add_tag' ? a.tag?.trim()
      : a.type === 'add_to_board' ? a.boardId
        : a.type === 'webhook' ? a.url?.trim()
          : true,
  )
  return conditionsOk && actionsOk
})

async function save() {
  saving.value = true
  try {
    const { automation } = await saveAutomation(draft.value)
    emit('saved', automation)
    // A smart board's rule may have changed the board itself.
    if (automation.boardId) store.fetchBoards()
  } catch (error: any) {
    store.showAlert({ message: error?.data?.statusMessage || error?.data?.message || t('automations.save_failed'), type: 'danger' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!draft.value.id) return
  deleting.value = true
  try {
    await deleteAutomation(draft.value.id)
    emit('deleted', draft.value.id)
    if (draft.value.boardId) store.fetchBoards()
  } catch (error: any) {
    store.showAlert({ message: error?.data?.statusMessage || t('automations.delete_failed'), type: 'danger' })
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  if (!boards.value?.length) store.fetchBoards()
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.automation-card {
  @apply flex flex-col gap-5 p-5 rounded-2xl bg-white dark:bg-neutral-800
    border border-neutral-200 dark:border-neutral-700/70 shadow-sm;
}

.automation-icon {
  @apply flex items-center justify-center size-9 shrink-0 rounded-lg
    bg-neutral-100 dark:bg-neutral-700/60 text-lg text-neutral-600 dark:text-neutral-300;
}

</style>
