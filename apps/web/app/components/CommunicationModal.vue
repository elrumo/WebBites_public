<template>
    <UModal v-model:open="parseConfig.showMessageModal">
        <template #content>
            <div class="modal-body text-center md-parser" v-html="parseConfig.modalMessage"/>

            <div class="flex flex-col gap-1 p-4 w-full items-center">
                <UButton
                    variant="solid"
                    class="w-fit"
                    size="sm"
                    @click="handleClose"
                >
                {{ $t('common.close') }}
                </UButton>

                <UButton
                    variant="ghost"
                    class="w-fit"
                    size="xs"
                    @click="parseConfig.showMessageModal = false"
                >
                    {{ $t('common.remind_later') }}
                </UButton>
            </div>
        </template>
    </UModal>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { onMounted } from 'vue'

const store = useStore()
const { parseConfig } = storeToRefs(store)

onMounted(() => {
    try {
        const modalClosedData = localStorage.getItem('modalClosed')
        // console.log("modalClosedData: ", modalClosedData)
        if (modalClosedData) {
            const { closed, expiration } = JSON.parse(modalClosedData)
            if (closed && new Date().getTime() < expiration) {
                parseConfig.value.showMessageModal = false
            }
        }
    } catch (error) {
        console.error('[CommunicationModal] Error in onMounted:', error);
    }
})

const handleClose = () => {
    // Set expiration date to 2 weeks from now
    const expirationDate = new Date()
    expirationDate.setDate(expirationDate.getDate() + 14)

    // Save to local storage with expiration
    localStorage.setItem('modalClosed', JSON.stringify({
        closed: true,
        expiration: expirationDate.getTime()
    }))

    parseConfig.value.showMessageModal = false
}
</script>
