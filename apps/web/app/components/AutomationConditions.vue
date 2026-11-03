<template>
  <section class="flex flex-col gap-2">
    <div v-if="labelText" class="flex items-center justify-between min-h-6">
      <h3 class="automation-label">{{ labelText }}</h3>
      <USelect
        v-if="showMatch"
        v-model="match"
        :items="matchOptions"
        size="xs"
        variant="ghost"
      />
    </div>

    <p v-if="!conditions.length && emptyText" class="text-xs text-muted px-1 m-0">{{ emptyText }}</p>

    <!-- Two lines per row: what is compared (and remove) on top, the value underneath,
         so a narrow pane never pushes the remove button into the middle. -->
    <div v-for="(condition, i) in conditions" :key="i" class="automation-row">
      <div class="flex items-center gap-2">
        <UIcon :name="fieldIcon(condition.field)" class="automation-row-icon" />
        <USelect
          :model-value="condition.field"
          :items="fieldItems"
          size="sm"
          class="w-32"
          @update:model-value="setField(condition, $event)"
        />
        <USelect v-if="condition.field !== 'ai_topic'" v-model="condition.op" :items="opOptions" size="sm" class="w-36" />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="ms-auto"
          :aria-label="$t('automations.remove_condition')"
          @click="conditions.splice(i, 1)"
        />
      </div>

      <template v-if="condition.field === 'ai_topic'">
        <UInputTags v-model="condition.topics" :placeholder="$t('automations.topics_placeholder')" size="sm" class="w-full" />
        <label class="flex items-center gap-3 text-xs text-muted">
          {{ $t('automations.minimum_match') }}
          <USlider v-model="condition.threshold" :min="0" :max="1" :step="0.1" size="xs" class="flex-1" />
          <span class="tabular-nums w-9 text-right">{{ Math.round((condition.threshold ?? 0.6) * 100) }}%</span>
        </label>
      </template>
      <UInput
        v-else
        v-model="condition.value"
        :placeholder="valuePlaceholder(condition.field)"
        size="sm"
        class="w-full"
        :ui="{ base: 'font-mono' }"
      />
    </div>

    <button type="button" class="automation-add" @click="conditions.push({ field: 'url', op: 'contains', value: '' })">
      <UIcon name="i-lucide-plus" /> {{ $t('automations.add_condition') }}
    </button>
  </section>
</template>

<script lang="ts">
// Imported at module scope by BoardModal, so the labels resolve on read.
export const MATCH_OPTIONS = [
  { get label() { return useNuxtApp().$i18n.t('automations.match_all') }, value: 'all' },
  { get label() { return useNuxtApp().$i18n.t('automations.match_any') }, value: 'any' },
]
</script>

<script setup lang="ts">
import type { AutomationCondition } from '~/composables/useAutomations'

/**
 * The "if …" half of an automation, shared by the automation editor and the
 * board modal. The board modal gives AI topics their own field, so it leaves
 * `ai_topic` out of `fields`, counts the topics through `extraCount`, and
 * with no `label` draws the all/any picker itself.
 */
const props = withDefaults(defineProps<{
  label?: string
  fields?: AutomationCondition['field'][]
  extraCount?: number
  emptyText?: string
}>(), {
  fields: () => ['url', 'domain', 'title', 'type', 'tag', 'ai_topic'],
  extraCount: 0,
  emptyText: '',
})

const conditions = defineModel<AutomationCondition[]>({ required: true })
const match = defineModel<'all' | 'any'>('match', { default: 'all' })

const FIELD_ICONS: Record<string, string> = {
  url: 'i-lucide-link', domain: 'i-lucide-globe', title: 'i-lucide-type',
  type: 'i-lucide-shapes', tag: 'i-lucide-tag', ai_topic: 'i-lucide-sparkles',
}
const PLACEHOLDERS: Record<string, string> = {
  url: 'amazon.com', domain: 'github.com', title: 'recipe', type: 'article', tag: 'work',
}

const { t } = useI18n()
const labelText = computed(() => props.label ?? t('automations.if'))

const showMatch = computed(() => conditions.value.length + props.extraCount > 1)

const fieldItems = computed(() => props.fields.map(value => ({ label: t(`automations.fields.${value}`), value })))
const matchOptions = MATCH_OPTIONS
const opOptions = computed(() =>
  (['contains', 'not_contains', 'is', 'is_not'] as const).map(value => ({ label: t(`automations.ops.${value}`), value })),
)

const fieldIcon = (field: string) => FIELD_ICONS[field] || 'i-lucide-filter'
const valuePlaceholder = (field: string) => PLACEHOLDERS[field] || ''

function setField(condition: AutomationCondition, field: AutomationCondition['field']) {
  condition.field = field
  if (field === 'ai_topic') {
    condition.topics ??= []
    condition.threshold ??= 0.6
  } else if (!condition.op) {
    condition.op = 'contains'
  }
}
</script>

<!-- Unscoped: the automation editor's trigger and action rows use the same classes. -->
<style>
@reference "../assets/css/tailwind.css";

.automation-label {
  @apply text-xs font-semibold tracking-widest uppercase text-neutral-500 dark:text-neutral-400 m-0;
}

.automation-row {
  @apply flex flex-col gap-2 px-3 py-2.5 rounded-xl
    bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-100 dark:border-neutral-700/50;
}

.automation-row-icon {
  @apply text-lg shrink-0 text-neutral-500 dark:text-neutral-400;
}

.automation-add {
  @apply flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm
    text-neutral-500 dark:text-neutral-400 border border-dashed border-neutral-300 dark:border-neutral-600
    hover:bg-neutral-50 dark:hover:bg-neutral-700/30 transition-colors
    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary;
}
</style>
