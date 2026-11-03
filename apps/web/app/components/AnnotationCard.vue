<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2 annotation-card relative group w-64"
    :class="{ 'ring-2 ring-primary-500': isHovered }"
    :style="{
      'transform': 'translateX(calc(var(--is-flipped, 0) * -120%))'
    }"
    @mousedown.stop
    @click.stop
  >

    <div class="absolute -top-2 -right-2 flex flex-row gap-2 z-10">
      <!-- Delete Button -->
      <UButton
        size="md"
        @click.stop="$emit('delete')"
        class="rounded-full shadow-md hover:scale-105"
        variant="solid"
        color="neutral"
        square
      >
        <UIcon name="i-heroicons-trash" class="text-red-500" />
      </UButton>

      <!-- Close Button -->
      <UButton
        size="md"
        @click.stop="$emit('close')"
        class="rounded-full shadow-md hover:scale-105"
        variant="solid"
        color="neutral"
        square
      >
        <UIcon name="i-heroicons-x-mark"/>
      </UButton>
    </div>

    <!-- Textarea with top margin to account for drag handle -->
    <UTextarea
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      :placeholder="$t('website_modal.add_note')"
      variant="none"
      @click.stop
    />
  </div>
</template>

<script setup>
defineProps({
  modelValue: String,
  isHovered: Boolean
})

defineEmits(['update:modelValue', 'delete'])
</script>
