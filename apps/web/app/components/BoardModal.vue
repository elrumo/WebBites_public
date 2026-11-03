<template>
  <UModal
    v-model:open="showBoardModal"
    :title="boardToEdit ? $t('boards.modal.edit_title') : $t('boards.modal.new_title')"
    :ui="{ content: 'max-w-md', body: 'flex flex-col gap-5', footer: 'flex-wrap' }"
  >
    <template #body>
      <!-- Identity: the emoji tile doubles as a live preview of icon + colour -->
      <div class="flex items-stretch gap-2">
        <UPopover v-model:open="emojiOpen" :ui="{ content: 'w-[19rem] max-h-[22rem] overflow-y-auto' }">
          <button
            type="button"
            class="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-2xl leading-none ring-1 ring-inset ring-default transition-all hover:ring-2 hover:ring-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :style="tileStyle"
            :aria-label="$t('boards.modal.choose_emoji')"
          >
            <span v-if="form.icon">{{ form.icon }}</span>
            <UIcon v-else name="i-tabler-mood-smile" class="w-5 h-5 text-muted" />
          </button>

          <template #content>
            <div class="p-2 flex flex-col gap-2">
              <div class="flex gap-1.5">
                <UInput
                  :model-value="''"
                  size="sm"
                  class="flex-1"
                  :placeholder="$t('boards.modal.emoji_placeholder')"
                  @update:model-value="pickEmoji"
                />
                <UButton
                  v-if="form.icon"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  :label="$t('boards.modal.remove_emoji')"
                  @click="pickEmoji('')"
                />
              </div>
              <div v-for="group in emojiGroups" :key="group.label">
                <p class="text-[11px] font-medium uppercase tracking-wider text-muted px-1 mb-1 mt-1">
                  {{ group.label }}
                </p>
                <div class="grid grid-cols-8">
                  <button
                    v-for="emoji in group.emojis"
                    :key="emoji"
                    type="button"
                    class="h-9 rounded-md text-xl leading-none hover:bg-elevated transition-colors"
                    :class="form.icon === emoji ? 'bg-elevated ring-1 ring-inset ring-primary' : ''"
                    @click="pickEmoji(emoji)"
                  >
                    {{ emoji }}
                  </button>
                </div>
              </div>
            </div>
          </template>
        </UPopover>

        <UInput
          v-model="form.name"
          class="flex-1"
          size="xl"
          :placeholder="$t('boards.modal.name_placeholder')"
          :maxlength="100"
          autofocus
          :ui="{ base: 'h-11 font-medium' }"
          @keydown.enter="save"
        />
      </div>

      <UTextarea
        v-model="form.description"
        :placeholder="$t('boards.modal.description_placeholder')"
        :maxlength="1000"
        :rows="2"
        autoresize
      />

      <UFormField
        :label="$t('boards.modal.inside')"
        :help="$t('boards.modal.inside_help')"
      >
        <USelectMenu
          v-model="form.parentId"
          :items="parentOptions"
          value-key="value"
          label-key="label"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="$t('boards.modal.how_added')">
        <URadioGroup
          v-model="form.mode"
          variant="card"
          size="sm"
          :items="modeOptions"
          :ui="{ fieldset: 'gap-2', item: 'bg-elevated/40 has-data-[state=checked]:bg-primary/5', base: 'dark:ring-neutral-500', description: 'text-xs' }"
        />
      </UFormField>

      <!-- Smart rules (shown when mode is smart) -->
      <div
        v-if="isSmart"
        class="flex flex-col gap-4 p-4 rounded-xl bg-elevated/60 ring-1 ring-inset ring-default"
      >
        <UFormField
          :label="$t('boards.modal.ai_topics')"
          :hint="$t('boards.modal.ai_topics_hint')"
          :help="$t('boards.modal.ai_topics_help')"
        >
          <UInput
            v-model="topicsInput"
            :placeholder="$t('boards.modal.topics_placeholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="$t('boards.modal.confidence')">
          <div class="flex items-center gap-3">
            <USlider
              v-model="form.smartRules.confidenceThreshold"
              :min="0"
              :max="1"
              :step="0.1"
              class="flex-1"
            />
            <span class="text-xs tabular-nums text-muted w-9 text-right">
              {{ Math.round(form.smartRules.confidenceThreshold * 100) }}%
            </span>
          </div>
        </UFormField>

        <!-- Exact rules, stored on the board's automation next to the AI topics. -->
        <UFormField :label="$t('boards.modal.conditions')" :help="$t('boards.modal.conditions_help')">
          <template #hint>
            <USelect
              v-if="form.rule.conditions.length + (form.smartRules.topics.length ? 1 : 0) > 1"
              v-model="form.rule.match"
              :items="MATCH_OPTIONS"
              size="xs"
              variant="ghost"
            />
          </template>
          <AutomationConditions
            v-model="form.rule.conditions"
            v-model:match="form.rule.match"
            label=""
            :fields="['url', 'domain', 'title', 'type', 'tag']"
            :extra-count="form.smartRules.topics.length ? 1 : 0"
          />
        </UFormField>

        <USwitch
          size="sm"
          v-model="form.smartRules.autoApply"
          :label="$t('boards.modal.auto_apply')"
          :description="$t('boards.modal.auto_apply_help')"
        />
        <USwitch
          size="sm"
          v-if="!boardToEdit"
          v-model="form.smartRules.includeExisting"
          :label="$t('boards.modal.include_existing')"
          :description="$t('boards.modal.include_existing_help')"
        />
        <!-- A saved smart board is an automation: more conditions and actions live there. -->
        <UButton
          v-if="boardToEdit?.smartRules?.autoApply"
          variant="link"
          color="neutral"
          size="xs"
          class="w-fit px-0"
          :label="$t('boards.modal.automations_link')"
          @click="editAsAutomation"
        />
      </div>

      <UFormField :label="$t('boards.modal.colour')">
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="color in presetColors"
            :key="color"
            type="button"
            class="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
            :style="{ backgroundColor: color }"
            :aria-pressed="form.color === color"
            @click="form.color = color"
          >
            <UIcon v-if="form.color === color" name="i-tabler-check" class="w-4 h-4 text-white" />
          </button>
          <button
            type="button"
            class="w-7 h-7 rounded-full flex items-center justify-center border border-dashed border-default text-muted transition-all hover:scale-110 hover:text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
            :class="!form.color ? 'border-solid border-2 border-default text-default' : ''"
            :aria-pressed="!form.color"
            :aria-label="$t('boards.modal.no_colour')"
            @click="form.color = ''"
          >
            <UIcon name="i-tabler-ban" class="w-3.5 h-3.5" />
          </button>
        </div>
      </UFormField>
    </template>

    <template #footer>
      <UButton
        v-if="boardToEdit"
        color="error"
        variant="ghost"
        class="mr-auto"
        :loading="deleting"
        :label="$t('boards.delete_board')"
        @click="handleDelete"
      />
      <!-- Archiving is the gentler half of deleting: the board keeps its
           bookmarks and only leaves the sidebar. -->
      <UButton
        v-if="boardToEdit"
        color="neutral"
        variant="ghost"
        icon="i-tabler-archive"
        :loading="archiving"
        :label="$t('boards.archive')"
        @click="handleArchive"
      />
      <UButton
        v-if="boardToEdit"
        color="neutral"
        variant="ghost"
        icon="i-tabler-copy"
        :loading="duplicating"
        :label="$t('boards.duplicate')"
        @click="handleDuplicate"
      />
      <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" :class="boardToEdit ? '' : 'ml-auto'" @click="showBoardModal = false" />
      <UButton
        :loading="saving"
        :disabled="!form.name.trim() || !smartRuleValid"
        :label="boardToEdit ? $t('boards.modal.save_changes') : $t('boards.modal.create')"
        @click="save"
      />
    </template>
  </UModal>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { MATCH_OPTIONS } from '~/components/AutomationConditions.vue'

const store = useStore()
const { t } = useI18n()
const { showBoardModal, boardToEdit, boards } = storeToRefs(store)

const saving = ref(false)
const deleting = ref(false)
const emojiOpen = ref(false)

const modeOptions = computed(() => [
  { value: 'manual', label: t('boards.modal.mode_manual'), description: t('boards.modal.mode_manual_help') },
  { value: 'smart', label: t('boards.modal.mode_smart'), description: t('boards.modal.mode_smart_help') }
])

const presetColors = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6b7280'
]

// ponytail: curated grid instead of a full picker dependency; the text field
// above it accepts any emoji from the OS picker or clipboard.
const emojiGroups = computed(() => [
  { label: t('boards.modal.emoji_work'), emojis: ['💼', '📁', '📌', '📝', '📊', '📈', '🧠', '💡', '🎯', '🚀', '🔧', '⚙️', '🧪', '🔬', '💻', '📱', '🗂️', '📚', '🔖', '✅', '📅', '💬', '🔍', '✨'] },
  { label: t('boards.modal.emoji_creative'), emojis: ['🎨', '🖌️', '✏️', '📷', '🎬', '🎵', '🎸', '🎧', '📺', '🎮', '🕹️', '🎲', '🧩', '🪄', '🖼️', '🎭', '📐', '🧵', '🏗️', '🔮', '🌈', '⭐', '🔥', '❤️'] },
  { label: t('boards.modal.emoji_life'), emojis: ['🏠', '🛒', '🍕', '☕', '🍷', '🥗', '🏋️', '🧘', '🚴', '✈️', '🗺️', '🏖️', '🏔️', '🌍', '🚗', '🎁', '👶', '🐶', '🐱', '🌱', '💊', '💰', '🏦', '📦'] },
  { label: t('boards.modal.emoji_misc'), emojis: ['🌟', '⚡', '🌙', '☀️', '🌊', '🍀', '🦄', '🐙', '🦋', '🍄', '🧲', '🔑', '🔒', '🏆', '🎓', '🧬', '🛰️', '🪐', '🤖', '👾', '🎈', '🧭', '⏳', '❓'] }
])

const defaultForm = () => ({
  name: '',
  description: '',
  mode: 'manual',
  color: '',
  icon: '',
  parentId: null,
  smartRules: {
    topics: [],
    confidenceThreshold: 0.6,
    autoApply: true,
    includeExisting: false
  },
  // Exact conditions; they live on the board's automation, not the board.
  rule: { match: 'all', conditions: [] }
})

const form = ref(defaultForm())
const topicsInput = ref('')

const isSmart = computed(() => form.value.mode === 'smart')

// A smart board needs something to match on, and every condition needs a value.
const smartRuleValid = computed(() => {
  if (!isSmart.value) return true
  const { conditions } = form.value.rule
  return (form.value.smartRules.topics.length > 0 || conditions.length > 0)
    && conditions.every(c => c.value?.trim())
})

const editAsAutomation = () => {
  store.automationToEdit = boardToEdit.value.id
  showBoardModal.value = false
  store.showSettingsModal = true
}

/** Only folders can hold a board. */
const parentOptions = computed(() => {
  const eligible = boards.value.filter(board => board.kind === 'folder' && board.role !== 'viewer')
  const label = (board) => '— '.repeat(board.path?.length ?? 0) + board.name
  return [
    { label: t('boards.modal.top_level'), value: null },
    ...eligible.map(board => ({ label: label(board), value: board.id }))
  ]
})

const duplicating = ref(false)
const archiving = ref(false)

const handleDuplicate = async () => {
  if (!boardToEdit.value || duplicating.value) return
  duplicating.value = true
  if (await store.duplicateBoardAction(boardToEdit.value)) showBoardModal.value = false
  duplicating.value = false
}

const handleArchive = async () => {
  if (!boardToEdit.value || archiving.value) return
  archiving.value = true
  if (await store.archiveBoardAction(boardToEdit.value)) showBoardModal.value = false
  archiving.value = false
}

// Tint the tile with the chosen colour so icon + colour are previewed together.
const tileStyle = computed(() => form.value.color
  ? { backgroundColor: form.value.color + '26' }
  : undefined
)

// Keep only the first grapheme so pasted text or a ZWJ sequence stays one emoji.
const pickEmoji = (val) => {
  const first = typeof Intl?.Segmenter === 'function'
    ? [...new Intl.Segmenter().segment(val)][0]?.segment
    : Array.from(val)[0]
  form.value.icon = (first || '').trim()
  emojiOpen.value = false
}

// Sync topics input to/from form.smartRules.topics
watch(topicsInput, (val) => {
  form.value.smartRules.topics = val
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
})

// Reset form when modal opens
watch(showBoardModal, (val) => {
  if (!val) store.newBoardParentId = null
  if (val) {
    if (boardToEdit.value) {
      // Edit mode: populate from existing board
      form.value = {
        name: boardToEdit.value.name || '',
        description: boardToEdit.value.description || '',
        mode: boardToEdit.value.mode === 'manual' || !boardToEdit.value.mode ? 'manual' : 'smart', // legacy 'mixed' boards are smart now
        color: boardToEdit.value.color || '',
        icon: boardToEdit.value.icon || '',
        parentId: boardToEdit.value.parentId ?? null,
        smartRules: {
          topics: boardToEdit.value.smartRules?.topics || [],
          confidenceThreshold: boardToEdit.value.smartRules?.confidenceThreshold ?? 0.6,
          autoApply: boardToEdit.value.smartRules?.autoApply ?? true,
          includeExisting: boardToEdit.value.smartRules?.includeExisting ?? false
        }
      }
      topicsInput.value = (boardToEdit.value.smartRules?.topics || []).join(', ')
      form.value.rule = { match: 'all', conditions: [] }
      if (boardToEdit.value.mode !== 'manual') loadRule(boardToEdit.value.id)
    } else {
      // Create mode: reset form
      form.value = defaultForm()
      form.value.parentId = store.newBoardParentId
      topicsInput.value = ''
    }
  }
})

// The board's exact conditions come from its automation (AI topics are in smartRules).
const loadRule = async (boardId) => {
  try {
    const { automations } = await useAutomations().fetchAutomations()
    const automation = automations.find(a => a.boardId === boardId)
    // Still the same board open? The fetch can land after a quick switch.
    if (!automation || boardToEdit.value?.id !== boardId) return
    form.value.rule = {
      match: automation.match,
      conditions: automation.conditions.filter(c => c.field !== 'ai_topic')
    }
  } catch (error) {
    console.error('Error loading board conditions:', error)
  }
}

const save = async () => {
  if (!form.value.name.trim() || !smartRuleValid.value || saving.value) return

  saving.value = true
  try {
    const { createBoard, updateBoard } = useBoards()

    const payload = {
      name: form.value.name.trim(),
      description: form.value.description.trim() || undefined,
      mode: form.value.mode,
      color: form.value.color || undefined,
      icon: boardToEdit.value ? form.value.icon : (form.value.icon || undefined),
      // Always sent, including as null: leaving it out on an edit would mean
      // "don't change", and there would be no way to move a board back to the
      // top level.
      parentId: form.value.parentId
    }

    // Include smartRules only for smart mode
    if (isSmart.value) {
      payload.smartRules = {
        topics: form.value.smartRules.topics,
        confidenceThreshold: form.value.smartRules.confidenceThreshold,
        autoApply: form.value.smartRules.autoApply,
        includeExisting: form.value.smartRules.includeExisting
      }
      payload.rule = form.value.rule
    }

    if (boardToEdit.value) {
      const response = await updateBoard(boardToEdit.value.id, payload)
      // Merged, not replaced: the response carries no `role` / `shared`.
      store.replaceBoard(response.board)
      store.showAlert({ message: t('boards.modal.updated') })
    } else {
      const response = await createBoard(payload)
      boards.value.push(response.board)
      store.showAlert({ message: t('boards.modal.created') })
    }

    showBoardModal.value = false
  } catch (error) {
    console.error('Error saving board:', error)
    store.showAlert({ message: t('boards.modal.save_error'), type: 'danger' })
  } finally {
    saving.value = false
  }
}

// The confirmation is an alert, which would sit under this modal's overlay:
// step aside for it, and come back if the answer was no.
const handleDelete = async () => {
  const board = boardToEdit.value
  if (!board || deleting.value) return
  deleting.value = true
  showBoardModal.value = false
  if (!await store.deleteBoardAction(board)) {
    boardToEdit.value = board
    showBoardModal.value = true
  }
  deleting.value = false
}
</script>
