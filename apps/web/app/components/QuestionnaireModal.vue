<template>
  <!-- Three optional questions shown once, after the welcome tour. Every way out
       (Skip, Esc, clicking away) saves what was answered so it never returns.
       Answers land on the user's `questionnaire` column in English, whatever
       the UI language, so they stay analysable. -->
  <UModal
    v-model:open="open"
    :ui="{ content: 'w-[520px] max-w-[92vw] bg-transparent shadow-none ring-0 border-0' }"
  >
    <template #content>
      <div class="w-full bg-white dark:bg-neutral-900 shadow-xl border border-slate-200 dark:border-neutral-800 rounded-2xl p-6 flex flex-col gap-5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="flex gap-1.5">
              <span
                v-for="(_, i) in steps"
                :key="i"
                class="h-1 rounded-full transition-all duration-300"
                :class="i === step ? 'w-8 bg-primary-500' : i < step ? 'w-4 bg-primary-400 opacity-60' : 'w-4 bg-neutral-200 dark:bg-neutral-600'"
              />
            </div>
            <span class="text-xs opacity-60">{{ $t('questionnaire.step', { current: step + 1, total: steps.length }) }}</span>
          </div>
          <UButton variant="ghost" color="neutral" size="sm" @click="finish">
            {{ $t('wizard_tab.skip') }}
          </UButton>
        </div>

        <div class="flex flex-col gap-1">
          <p class="text-xs font-medium uppercase tracking-wide text-primary-500">{{ $t('questionnaire.eyebrow') }}</p>
          <h2 class="text-xl font-bold">{{ $t(`questionnaire.${current.title}`) }}</h2>
          <p class="text-sm opacity-60">{{ $t('questionnaire.hint') }}</p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="opt in current.options"
            :key="opt"
            size="md"
            :color="picked.includes(opt) ? 'primary' : 'neutral'"
            :variant="picked.includes(opt) ? 'solid' : 'outline'"
            :aria-pressed="picked.includes(opt)"
            @click="toggle(opt)"
          >
            {{ $t(`questionnaire.${opt}`) }}
          </UButton>
        </div>

        <UInput v-model="extra" :placeholder="$t('questionnaire.other')" @keyup.enter="next" />

        <div class="flex justify-between">
          <UButton v-if="step > 0" variant="ghost" color="neutral" icon="i-heroicons-arrow-left" @click="step--">
            {{ $t('wizard_tab.back') }}
          </UButton>
          <span v-else />
          <UButton
            :color="hasAnswer ? 'primary' : 'neutral'"
            :variant="hasAnswer ? 'solid' : 'soft'"
            :icon="last ? 'i-heroicons-check' : 'i-heroicons-arrow-right'"
            @click="next"
          >
            {{ !hasAnswer ? $t('questionnaire.skip_question') : last ? $t('wizard_tab.finish') : $t('wizard_tab.next') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup>
import Parse from 'parse'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()
const { showQuestionnaireModal: open } = storeToRefs(store)
const { showAlert } = store
const { t } = useI18n()

// Titles and options are i18n keys under `questionnaire`; the English labels
// in `EN` are what get stored.
const steps = [
  { field: 'currentBookmarkManager', title: 'q_tools', options: ['browser', 'raindrop', 'pocket', 'notion', 'notes', 'pinterest', 'none'] },
  { field: 'mostInterested', title: 'q_interest', options: ['find', 'organise', 'devices', 'visual', 'later', 'share'] },
  { field: 'whatAiLooksLike', title: 'q_ai', options: ['tags', 'search', 'boards', 'summaries', 'duplicates'] },
]
const EN = {
  browser: 'Browser bookmarks', raindrop: 'Raindrop', pocket: 'Pocket', notion: 'Notion', notes: 'Apple Notes', pinterest: 'Pinterest', none: 'Nothing yet',
  find: 'Finding things again', organise: 'Staying organised', devices: 'Saving from any device', visual: 'A visual archive', later: 'Reading later', share: 'Sharing boards',
  tags: 'Automatic tags', search: 'Search in plain words', boards: 'Sorted into boards', summaries: 'Summaries', duplicates: 'Spotting duplicates',
}

const step = ref(0)
const picked = ref([])
const extra = ref('')
const answers = {}
const current = computed(() => steps[step.value])
const last = computed(() => step.value === steps.length - 1)
const hasAnswer = computed(() => picked.value.length > 0 || extra.value.trim().length > 0)

const toggle = (opt) => {
  picked.value = picked.value.includes(opt) ? picked.value.filter(o => o !== opt) : [...picked.value, opt]
}

const remember = () => {
  if (!hasAnswer.value) return
  answers[current.value.field] = [...picked.value.map(o => EN[o]), extra.value.trim()].filter(Boolean).join(', ')
}

const next = () => {
  remember()
  if (last.value) return finish(true)
  step.value++
  picked.value = []
  extra.value = ''
}

let saved = false
// `answered` is true only from the last step's button (already remembered);
// Skip, Esc and click-away still record whatever step they interrupted.
async function finish(answered = false) {
  if (saved) return
  saved = true
  if (answered !== true) remember()
  open.value = false
  try {
    const user = Parse.User.current()
    user.set('questionnaire', { ...answers, skipped: !Object.keys(answers).length, answeredAt: new Date().toISOString(), source: 'web' })
    await user.save()
    if (Object.keys(answers).length) showAlert({ message: t('questionnaire.thanks') })
  } catch (error) {
    console.error('[questionnaire] save failed:', error)
  }
}

// Esc / click-away closes the modal without going through `finish`.
watch(open, (isOpen) => { if (!isOpen) finish() })
</script>
