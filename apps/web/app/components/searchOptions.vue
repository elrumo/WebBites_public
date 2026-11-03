<template>
    <div class="search-options-area-wrapper">
        <!-- <UDropdownMenu :items="orderOptions" class="w-fit">
            <UButton variant="ghost">
                {{ userOptions.orderBy == 'newFirst' ? '↑ ' + $t('settings.newest_first') : '↓ ' + $t('settings.oldest_first') }}
            </UButton>
        </UDropdownMenu> -->
        <UTooltip :text="t('settings.viewing_options')">
            <UPopover>
                <UButton 
                    variant="ghost" 
                    square 
                    color="neutral"
                    class="w-fit rounded-full"
                    size="sm"
                >
                    <IconBrew icon="dashboard" :size="20"/>
                </UButton>

                <template #content>
                    <ViewOptionsPanel class="p-4 min-w-80" />
                </template>
            </UPopover>
        </UTooltip>
    </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
import { ref, computed, watch, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()

// Destructure store actions
const { searchSites, saveUserOptions, fetchUserOptions } = store

// Destructure store state with storeToRefs for reactivity
const {
    userOptions,
    searchValue,
    displayMode,
    imageRatioOptions,
    imageRatio
} = storeToRefs(store)

// Data
const orderOptions = ref([
    [
        {
            label: t('settings.newest_first'),
            icon: 'i-heroicons-arrow-up',
            click: () => sortSites('newFirst')
        },
        {
            label: t('settings.oldest_first'),
            icon: 'i-heroicons-arrow-down',
            click: () => sortSites('oldFirst')
        }
    ]
])

// Methods
const sortSites = (order) => {
    userOptions.value.orderBy = order
    saveUserOptions('Sort sites')
    const searchQuery = searchValue.value ? searchValue.value : ' '
    console.log("searchQuery: ", searchQuery)
    searchSites(searchQuery, order)
}



// Watchers
watch(userOptions, (val, oldVal) => {
    displayMode.value.isMount = true
})

watch(imageRatio, (val, oldVal) => {
    try {
        userOptions.value.imageRatio = imageRatio.value.id.toLowerCase()
        saveUserOptions('watch imageRatio')
    } catch (error) {
        console.error("error in imageRatio watch, searchOptions.vue: ", error)
    }
})

watch(displayMode, (newValue, oldValue) => {
  // Skip if this is just the initial mount
  if (!newValue) return;

  // If we're mounting the component, sync with userOptions
  if (newValue.isMount) {
    const currentMode = userOptions.value.displayMode;
    displayMode.value = {
      id: currentMode.toLowerCase(),
      label: currentMode.charAt(0).toUpperCase() + currentMode.slice(1),
      isMount: false
    };
    return;
  }

  // Handle actual user selection
  if (newValue.id && newValue.label) {
    userOptions.value.displayMode = newValue.id.toLowerCase();
    saveUserOptions('watch displayMode');
  }
}, { deep: true });

// Lifecycle hooks
onMounted(async () => {
    // await fetchUserOptions()

    userOptions.value.orderBy = 'newFirst';
    // Initialize with current user options
    // displayMode.value = selectedDisplayMode.value;
});

defineOptions({
    name: 'searchOptions'
})
</script>
