<template>
  <!-- A tag or colour filter in the search bar. White on the light theme, like
       the bar around it; fully round and 14px/500 like the composer's pills. -->
  <span class="search-chip">
    <span
      v-if="filter.kind === 'color'"
      class="size-3 shrink-0 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/25"
      :style="{ backgroundColor: filter.hex }"
    />
    <span v-else class="opacity-40">#</span>
    <span class="truncate" :class="{ capitalize: filter.kind === 'color' }">{{ filter.label }}</span>
    <button
      v-if="removable"
      type="button"
      class="search-chip__x"
      :aria-label="$t('cards.search_chip.remove', { label: filter.label })"
      @mousedown.prevent
      @click.stop="emit('remove')"
    >
      <UIcon name="i-heroicons-x-mark-20-solid" class="size-3.5" />
    </button>
  </span>
</template>

<script setup>
defineProps({
  filter: { type: Object, required: true },
  removable: { type: Boolean, default: true }
})
const emit = defineEmits(['remove'])
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.search-chip{
  @apply
    inline-flex shrink-0 items-center gap-1.5
    h-[30px] max-w-52 pl-3 pr-1.5
    rounded-full whitespace-nowrap
    text-sm font-medium leading-none
    bg-white text-neutral-800
    dark:bg-neutral-800 dark:text-neutral-100
  ;

  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
}

:global(.dark) .search-chip{
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.1);
}

.search-chip__x{
  @apply
    inline-flex size-5 items-center justify-center rounded-full
    text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100
    dark:hover:text-neutral-100 dark:hover:bg-neutral-700
    transition-colors
  ;
}
</style>
