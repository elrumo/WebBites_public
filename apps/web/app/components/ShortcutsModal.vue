<template>
    <UModal
        class="z-[9999]"
        v-model:open="shortcutsModal"
        :ui="{
            overlay: 'modal-blur',
         }"
    >
  <template #content>
        <div class="p-4 w-screen max-w-2xl">
            <div v-for="shortcut in shortcuts" class="shortcut-item">
                <div class="flex items-baseline gap-2 w-full">
                    <UIcon :name="shortcut.icon" class="text-md" />
                    <p>
                        {{ shortcut.name }}
                        <small class="opacity-70 font-medium" v-if="shortcut.description">
                            {{ shortcut.description }}
                        </small>
                    </p>
                </div>
                <span>
                    <UKbd size="md" v-for="key in shortcut.keys"> {{ key }} </UKbd>
                </span>
            </div>
        </div>
    
  </template>
</UModal>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const store = useStore()
const { shortcutsModal } = storeToRefs(store)

const shortcuts = computed(() => [
    {
        name: t('common.shortcuts.quick_save.name'),
        keys: ['⌘', 'V'],
        description: t('common.shortcuts.quick_save.description'),
        icon: 'heroicons:clipboard-document'
    },
    {
        name: t('common.shortcuts.focus_search.name'),
        description: t('common.shortcuts.focus_search.description'),
        keys: ['/'],
        icon: 'heroicons:magnifying-glass'
    },
    // {
    //     name: 'Quick search',
    //     keys: ['⌘', 'K/J'],
    // },
    {
        name: t('common.shortcuts.open_website.name'),
        keys: ['⌘', t('shortcuts_modal.click')],
        description: t('common.shortcuts.open_website.description'),
        icon: 'heroicons:arrow-top-right-on-square'
    },
    {
        name: t('common.shortcuts.select_card.name'),
        keys: ['⇧', t('shortcuts_modal.click')],
        description: t('common.shortcuts.select_card.description'),
        icon: 'heroicons:cursor-arrow-rays'
    },
    {
        name: t('common.shortcuts.copy_url.name'),
        keys: ['⌥', t('shortcuts_modal.click')],
        description: t('common.shortcuts.copy_url.description'),
        icon: 'heroicons:link'
    },
])

let metaPressed = false
let metaTimer = null
let keys = []

// Event handler functions
const handleKeyDown = (e) => {
    keys.push(e.key)
    if (e.key === 'Meta') {
        metaPressed = true
        metaTimer = setTimeout(() => {
            if (metaPressed && keys.length == 1) {
                shortcutsModal.value = true
                console.log('meta key pressed for 2 seconds')
            }
        }, 1500)
    }
}

const handleBlur = (e) => {
    metaPressed = false
    keys = []
    metaTimer = null
    shortcutsModal.value = false
    clearTimeout(metaTimer)
}

const handleKeyUp = (e) => {
    keys = keys.filter(key => key !== e.key)
    if (e.key === 'Meta') {
        metaPressed = false
        shortcutsModal.value = false
        clearTimeout(metaTimer)
    }
}

onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('keyup', handleKeyUp)
})

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('blur', handleBlur)
    window.removeEventListener('keyup', handleKeyUp)
})
</script>
