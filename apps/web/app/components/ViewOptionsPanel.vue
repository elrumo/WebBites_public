<template>
    <div class="view-options-panel">
        <h6 class="view-options-title">
            {{ $t('settings.viewing_options') }}
        </h6>

        <ClientOnly>
            <div class="pt-2 flex flex-col gap-2">
                <!-- View as -->
                <div class="toggle-wrapper">
                    <label>{{ $t('settings.view_as') }}</label>
                    <USelectMenu
                        class="min-w-40"
                        v-model="selectedDisplayMode"
                        :items="viewingOptions"
                        size="sm"
                        color="neutral"
                        :search-input="false"
                        :placeholder="$t('common.choose_something')"
                    />
                </div>

                <!-- Columns (grid only) -->
                <div v-if="userOptions.displayMode?.toLowerCase() === 'grid'" class="toggle-wrapper">
                    <label>{{ $t('settings.grid_columns') }}</label>
                    <USelectMenu
                        class="min-w-40"
                        v-model="selectedColumns"
                        :items="columnOptions"
                        size="sm"
                        color="neutral"
                        :search-input="false"
                    />
                </div>

                <div class="toggle-wrapper !mt-3">
                    <label>{{ $t('settings.show_summary_card') }}</label>
                    <USwitch v-model="userOptions.summaryCardOnHover" @update:model-value="saveUserOptions('Show sumary card on hover')" size="lg" />
                </div>

                <div class="toggle-wrapper">
                    <label>{{ $t('settings.preview_screenshots') }}</label>
                    <USwitch v-model="userOptions.screenshotAsThumbnail" @update:model-value="saveUserOptions('Preview page screenshots')" size="lg" />
                </div>

                <div class="toggle-wrapper">
                    <label>{{ $t('settings.preview_tags') }}</label>
                    <USwitch v-model="userOptions.previewTags" @update:model-value="saveUserOptions('Preview tags')" size="lg" />
                </div>

                <div class="toggle-wrapper">
                    <label>{{ $t('settings.show_description') }}</label>
                    <USwitch v-model="userOptions.showDescription" @update:model-value="saveUserOptions('Show description')" size="lg" />
                </div>
            </div>
        </ClientOnly>
    </div>
</template>

<script setup>
/**
 * The viewing options, as one panel.
 *
 * The desktop top bar opens it from its own button; on a phone the same panel
 * is a section of the "…" menu, which is the only place chrome lives there.
 * Two instances of it can be mounted at once — both write straight to the
 * store, so whichever one the user reaches is the same set of switches.
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()

const { saveUserOptions } = store

const {
    userOptions,
    viewingOptions
} = storeToRefs(store)

const selectedDisplayMode = computed({
    get: () => {
        const option = viewingOptions.value.find(opt =>
            opt.id.toLowerCase() === userOptions.value.displayMode.toLowerCase()
        )
        return option || {
            id: userOptions.value.displayMode.toLowerCase(),
            label: userOptions.value.displayMode
        }
    },
    set: (newValue) => {
        if (newValue && newValue.id) {
            userOptions.value.displayMode = newValue.id.toLowerCase()
            saveUserOptions('selectedDisplayMode')
        }
    }
})

const { t } = useI18n()

const columnOptions = computed(() => [
    { id: 'auto', label: t('settings.grid_columns_auto') },
    ...[2, 3, 4, 5, 6].map(n => ({ id: n, label: String(n) }))
])

// Accounts saved before this option existed have no value: that means auto.
const selectedColumns = computed({
    get: () => columnOptions.value.find(o => o.id === (userOptions.value.gridColumns ?? 'auto')) ?? columnOptions.value[0],
    set: (option) => {
        if (!option) return
        userOptions.value.gridColumns = option.id
        saveUserOptions('gridColumns')
    }
})

defineOptions({
    name: 'ViewOptionsPanel'
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.view-options-title{
    @apply mb-2 font-bold opacity-80;
}
</style>
