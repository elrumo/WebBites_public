<template>
    <!-- Phone: one scrolling row of pills at the head of the grid, the way the
         native app puts them there. The vertical tabs below are the desktop
         sidebar's shape for the same filter. -->
    <div v-if="horizontal" class="type-pills-row">
        <div class="type-pills-track">
            <button
                type="button"
                class="type-pill"
                :class="{ 'type-pill--active': activeValue === 'all' }"
                @click="selectType('all')"
            >
                <img
                    class="size-4 shrink-0"
                    src="/webbites-logo-medium.png"
                    alt=""
                    loading="lazy"
                />
                <span>{{ $t('cards.everything') }}</span>
            </button>

            <button
                v-for="type in bookmarkTypes"
                :key="type.value"
                type="button"
                class="type-pill"
                :class="{ 'type-pill--active': activeValue === type.value }"
                @click="selectType(type.value)"
            >
                <IconBrew :icon="type.icon" :size="17" />
                <span>{{ type.label }}</span>
            </button>
        </div>
    </div>

    <div v-else class="flex flex-col gap-2 w-full max-w-[200px]">
      <!-- Type Tabs -->
      <UTabs
        :items="tabItems"
        v-model="selectedTabValue"
        value-key="value"
        orientation="vertical"
        size="sm"
        :ui="{ 
          root: 'flex items-center gap-4',
          list: 'relative w-full h-full bg-transparent dark:bg-transparent p-0',
          indicator: [
            'bg-neutral-600 dark:bg-neutral-950 ring-1 ring-neutral-200/20 dark:ring-neutral-700/50 shadow-md shadow-neutral-600/20 dark:shadow-black/30 rounded-lg transition-all duration-200 ease-out w-full -ml-1',
            typeIsActive === 'null' ? 'opacity-0' : 'opacity-100'
          ],
          trigger: 'relative mb-0.5 px-2 w-full h-7 text-gray-500 transition-colors rounded-lg data-[state=inactive]:hover:bg-neutral-200 data-[state=inactive]:dark:hover:bg-neutral-700/60 data-[state=active]:bg-transparent data-[state=active]:text-white dark:data-[state=active]:text-white',
          label: 'w-full truncate',
        }"
        :content="false"
      >
        <template #default="{ item, selected}">
          <span 
            class="flex items-center justify-start gap-2 truncate w-full text-sm p-0.5"
            :class="selected ? 'font-medium text-white' : 'font-normal'"
          >
            <IconBrew 
              v-if="item.brewIcon" 
              :icon="item.brewIcon" 
              :size="16"
            />
            <img
              v-if="item.webbitesLogo"
              class="transition-all size-3.5"
              src="/webbites-logo-medium.png"
              alt="logo"
              loading="lazy"
            />
            <span class="truncate">
              {{ item.label }}
            </span>
          </span>
        </template>
      </UTabs>
    </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const { t } = useI18n()
const store = useStore()
const { 
    bookmarkTypes, 
    typesFilter, 
    subTypesFilter, 
    activeBoard,
    rssScope,
    privateScope,
    typeIsActive
} = storeToRefs(store)

const { setSearchType } = store

const props = defineProps({
  horizontal: {
    type: Boolean,
    default: true
  }
})

const tabItems = computed(() => {
  const allTab = { label: t('cards.everything'), value: 'all', webbitesLogo: true }
  return [allTab, ...bookmarkTypes.value.map(t => ({ ...t, value: t.value, brewIcon: t.icon, icon: undefined }))]
})

const selectedTabValue = computed({
  get() {
    // A board, a feed or the Private section owns the selection; none of them
    // is a type filter, so no pill (not even Everything) should read as active.
    if (activeBoard.value || rssScope.value !== null || privateScope.value) {
      typeIsActive.value = 'null'
      return 'null'
    }
    if (typesFilter.value.length === 0 && subTypesFilter.value.length === 0) {
      console.log('no filters')
      return 'all'
    }
    const activeFilter = typesFilter.value[0] || subTypesFilter.value[0]
    if (activeFilter) {
      return activeFilter.value
    }
    console.log('no active filter')
    return 'all'
  },
  set(value) {
    onTabChange(value)
  }
})

/** Which pill reads as chosen: a type, everything, or nothing at all while a
 *  board or a feed owns the grid. */
const activeValue = computed(() => {
  if (activeBoard.value || rssScope.value !== null) return null
  const activeFilter = typesFilter.value[0] || subTypesFilter.value[0]
  return activeFilter ? activeFilter.value : 'all'
})

/** The pills hand over the whole type, so the filter keeps its icon; the tabs
 *  go through `onTabChange`, which only has the tab item to work with. */
const selectType = (value) => {
  if (value === 'all') {
    setSearchType('', true)
  } else {
    const type = bookmarkTypes.value.find(item => item.value === value)
    if (type) setSearchType(type)
  }

  typeIsActive.value = value
}

const onTabChange = (value) => {
  if (value === 'all') {
    setSearchType('', true)
  } else {
    const selectedType = tabItems.value.find(item => item.value === value)
    if (selectedType) setSearchType(selectedType)
  }

  typeIsActive.value = value
}

</script>

<style scoped>
@reference "../assets/css/tailwind.css";

/* The row runs to both edges of the screen and scrolls; wrapping it onto a
   second line is what used to push the grid down a whole row of chrome. */
.type-pills-row{
    @apply
        w-full
        overflow-x-auto overflow-y-hidden
        overscroll-x-contain
    ;

    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar{
        display: none;
    }
}

.type-pills-track{
    @apply
        flex flex-row flex-nowrap items-center gap-2
        w-max
        px-3 py-1
    ;
}

.type-pill{
    @apply
        flex flex-row items-center gap-1.5
        h-9 px-3.5
        text-sm font-medium whitespace-nowrap
        rounded-full
        bg-white/80 dark:bg-neutral-800/80
        ring ring-1 ring-neutral-200/70 dark:ring-neutral-700/70
        shadow-sm shadow-neutral-500/5
        transition-all duration-150
        active:scale-95
    ;
}

.type-pill--active{
    @apply
        bg-neutral-900 dark:bg-neutral-100
        text-white dark:text-neutral-900
        ring-transparent
        shadow-md shadow-neutral-900/15 dark:shadow-black/30
    ;
}
</style>
