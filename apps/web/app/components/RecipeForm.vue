<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <h3 v-if="title" class="text-xl font-bold">{{ title }}</h3>

    <UFormField :label="$t('recipe.field_title')" :error="showErrors && !form.title.trim() ? $t('recipe.error_title') : undefined" required>
      <UInput v-model="form.title" class="w-full" maxlength="200" />
    </UFormField>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <UFormField :label="$t('recipe.field_yield')">
        <UInput v-model="form.yield" class="w-full" maxlength="80" :placeholder="$t('recipe.field_yield_placeholder')" />
      </UFormField>
      <UFormField :label="$t('recipe.field_prep')">
        <UInput v-model="form.prepMinutes" class="w-full" type="number" min="0" inputmode="numeric" />
      </UFormField>
      <UFormField :label="$t('recipe.field_cook')">
        <UInput v-model="form.cookMinutes" class="w-full" type="number" min="0" inputmode="numeric" />
      </UFormField>
    </div>

    <UFormField :label="$t('recipe.field_ingredients')" :hint="$t('recipe.field_group_hint')" :error="showErrors && noContent ? $t('recipe.error_content') : undefined">
      <UTextarea v-model="form.ingredients" class="w-full" :rows="8" autoresize />
    </UFormField>

    <UFormField :label="$t('recipe.field_steps')" :hint="$t('recipe.field_group_hint')">
      <UTextarea v-model="form.steps" class="w-full" :rows="8" autoresize />
    </UFormField>

    <UFormField :label="$t('recipe.field_notes')">
      <UTextarea v-model="form.notes" class="w-full" :rows="3" autoresize />
    </UFormField>

    <UFormField :label="$t('recipe.field_source')">
      <UInput v-model="form.sourceUrl" class="w-full" type="url" placeholder="https://" />
    </UFormField>

    <div class="flex justify-end gap-2">
      <UButton type="button" color="neutral" variant="ghost" :label="$t('common.cancel')" @click="emit('cancel')" />
      <UButton type="submit" :label="$t('recipe.save')" :loading="saving" />
    </div>
  </form>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'

// The same form writes a new recipe (composer) and edits a saved one (detail
// view). It only builds the `recipe` object; the caller saves it.
const props = defineProps({
  /** A normalised recipe (see utils/recipe.js) to edit, or null for a blank one. */
  recipe: { type: Object, default: null },
  /** Pre-fills for a blank form, e.g. the row's own title and url. */
  initial: { type: Object, default: () => ({}) },
  saving: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
const emit = defineEmits(['submit', 'cancel'])

const form = reactive({ ...formFromRecipe(props.recipe), ...(props.recipe ? {} : props.initial) })
const showErrors = ref(false)
const noContent = computed(() => !textToSections(form.ingredients).length && !textToSections(form.steps).length)

function submit() {
  showErrors.value = true
  if (!form.title.trim() || noContent.value) return
  emit('submit', recipeFromForm(form, props.recipe || {}))
}
</script>
