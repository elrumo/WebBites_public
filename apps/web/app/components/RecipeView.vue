<template>
  <div class="recipe-view mx-auto w-full max-w-[1000px] px-4 py-8">
    <RecipeForm
      v-if="editing"
      :recipe="recipe"
      :initial="{ title: webToShow.siteTitle || '', sourceUrl: openUrl || '' }"
      :title="$t('recipe.edit')"
      :saving="saving"
      @submit="save"
      @cancel="editing = false"
    />

    <!-- The row is a recipe, but the backend has not (or could not) read the page yet. -->
    <div v-else-if="!recipe" class="flex flex-col items-center gap-3 py-16 text-center">
      <UIcon name="i-tabler-loader-2" class="size-7 animate-spin text-neutral-500" />
      <h2 class="text-xl font-bold">{{ $t('recipe.extracting') }}</h2>
      <p class="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">{{ $t('recipe.extracting_hint') }}</p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <UButton color="neutral" variant="soft" icon="i-tabler-pencil" :label="$t('recipe.write')" @click="editing = true" />
        <UButton v-if="openUrl" color="neutral" variant="ghost" :label="$t('recipe.show_page')" @click="emit('show-reader')" />
      </div>
    </div>

    <template v-else>
      <img
        v-if="hero"
        :src="hero"
        alt=""
        referrerpolicy="no-referrer"
        class="h-56 w-full rounded-2xl bg-neutral-200 object-cover dark:bg-neutral-800 sm:h-80"
      >

      <header class="mt-6 flex flex-col gap-2">
        <h2 class="text-3xl font-bold leading-tight">{{ recipe.title }}</h2>
        <p v-if="byline" class="text-sm text-neutral-500 dark:text-neutral-400">{{ byline }}</p>
        <p v-if="recipe.description" class="whitespace-pre-line text-[15px] leading-relaxed">{{ recipe.description }}</p>
        <div class="mt-1 flex flex-wrap gap-2">
          <UButton v-if="openUrl" :href="openUrl" target="_blank" rel="noopener noreferrer" color="neutral" variant="soft" size="sm" icon="i-tabler-external-link" :label="$t('recipe.open_original')" />
          <UButton color="neutral" variant="ghost" size="sm" icon="i-tabler-pencil" :label="$t('recipe.edit')" @click="editing = true" />
        </div>
      </header>

      <dl v-if="facts.length" class="mt-6 flex overflow-x-auto rounded-2xl bg-white py-3 dark:bg-neutral-900">
        <div v-for="fact in facts" :key="fact.label" class="recipe-fact flex min-w-[96px] flex-1 flex-col items-center gap-1 px-5">
          <dt class="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ fact.label }}</dt>
          <dd class="m-0 text-center text-lg font-bold text-neutral-700 dark:text-neutral-200">{{ fact.value }}</dd>
        </div>
      </dl>

      <div class="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section v-if="recipe.ingredients.length">
          <h3 class="text-lg font-bold">{{ $t('recipe.ingredients') }}</h3>
          <div v-for="(section, s) in recipe.ingredients" :key="s" class="mt-3">
            <h4 v-if="section.title" class="text-sm font-semibold text-neutral-500 dark:text-neutral-400">{{ section.title }}</h4>
            <ul class="mt-1 flex flex-col">
              <li v-for="(item, i) in section.items" :key="i">
                <label class="flex cursor-pointer items-start gap-3 py-1.5 text-[15px] leading-snug" :class="done[`i-${s}-${i}`] ? 'opacity-40 line-through' : ''">
                  <input v-model="done[`i-${s}-${i}`]" type="checkbox" class="mt-1 size-4 shrink-0 accent-current">
                  <span>{{ item }}</span>
                </label>
              </li>
            </ul>
          </div>
        </section>

        <section v-if="numberedSteps.length">
          <h3 class="text-lg font-bold">{{ $t('recipe.steps') }}</h3>
          <div v-for="(section, s) in numberedSteps" :key="s" class="mt-3">
            <h4 v-if="section.title" class="text-sm font-semibold text-neutral-500 dark:text-neutral-400">{{ section.title }}</h4>
            <ol class="mt-1 flex flex-col gap-1">
              <li v-for="step in section.items" :key="step.number">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-start gap-3 rounded-lg py-2 text-left text-[15px] leading-relaxed transition-opacity"
                  :class="done[`s-${step.number}`] ? 'opacity-40' : ''"
                  :aria-pressed="!!done[`s-${step.number}`]"
                  @click="done[`s-${step.number}`] = !done[`s-${step.number}`]"
                >
                  <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-neutral-200 text-xs font-bold dark:bg-neutral-800">{{ step.number }}</span>
                  <span>{{ step.text }}</span>
                </button>
              </li>
            </ol>
          </div>
        </section>
      </div>

      <section v-if="recipe.notes" class="mt-8 rounded-2xl bg-white p-4 dark:bg-neutral-900">
        <h3 class="text-lg font-bold">{{ $t('recipe.notes') }}</h3>
        <p class="mt-2 whitespace-pre-line text-sm leading-relaxed">{{ recipe.notes }}</p>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const emit = defineEmits(['show-reader'])

const { t } = useI18n()
const store = useStore()
const { webToShow } = storeToRefs(store)

// The modal keeps one instance while you page between bites, so everything is
// derived from `webToShow`.
const recipe = computed(() => recipeOf(webToShow.value))
const units = computed(() => ({ h: t('recipe.unit_hour'), m: t('recipe.unit_minute') }))

const hero = computed(() => recipe.value?.image || webToShow.value?.OGImage || '')
const openUrl = computed(() => recipe.value?.sourceUrl || (/^https?:\/\//i.test(webToShow.value?.url || '') ? webToShow.value.url : ''))
const byline = computed(() => [recipe.value?.author && t('recipe.by', { author: recipe.value.author }), recipe.value?.cuisine].filter(Boolean).join(' · '))

const facts = computed(() => {
  const r = recipe.value
  if (!r) return []
  return [
    r.prepMinutes && { label: t('recipe.prep'), value: formatMinutes(r.prepMinutes, units.value) },
    r.cookMinutes && { label: t('recipe.cook'), value: formatMinutes(r.cookMinutes, units.value) },
    r.totalMinutes && { label: t('recipe.total'), value: formatMinutes(r.totalMinutes, units.value) },
    r.yield && { label: t('recipe.servings'), value: r.yield },
  ].filter(Boolean)
})

// Steps are numbered straight through, across groups.
const numberedSteps = computed(() => {
  let number = 0
  return (recipe.value?.steps ?? []).map((section) => ({
    title: section.title,
    items: section.items.map((text) => ({ number: ++number, text })),
  }))
})

// Ticked ingredients and steps are this session's scratch state, not saved.
const done = reactive({})
const editing = ref(false)
const saving = ref(false)
watch(() => webToShow.value?.objectId, () => {
  for (const key of Object.keys(done)) delete done[key]
  editing.value = false
})

async function save(next) {
  saving.value = true
  const res = await store.saveRecipe({ id: webToShow.value.objectId, recipe: next })
  saving.value = false
  if (!res.success) return
  // Show the edit at once; the backend has rebuilt `recipeCard` from the same recipe.
  const site = webToShow.value
  site.recipe = next
  site.siteTitle = next.title
  site.recipeCard = {
    image: next.image || site.recipeCard?.image || '',
    totalMinutes: next.totalMinutes,
    yield: next.yield,
    ingredientCount: next.ingredients.reduce((n, s) => n + s.items.length, 0),
    stepCount: next.steps.reduce((n, s) => n + s.items.length, 0),
  }
  editing.value = false
}
</script>

<style scoped>
.recipe-fact + .recipe-fact { border-left: 1px solid rgb(0 0 0 / 0.08); }
:global(.dark) .recipe-fact + .recipe-fact { border-left-color: rgb(255 255 255 / 0.12); }
</style>
