<template>
    <div class="modal-footer">
        <div class="flex gap-4 w-full justify-end">
            <UButton
                @click="$emit('close')"
                variant="ghost"
            >
              {{ $t('common.close') }}
            </UButton>
            <UButton
                :disabled="disabled"
                @click="$emit('submit', {
                    confetti: false,
                    event: $event,
                    quickSave: false
                })"
                :color="isFirstTime ? 'green' : 'black'"
            >
              {{ saveLabel }}
            </UButton>
        </div>
    </div>
</template>

<script setup>
const props = defineProps({
    disabled: Boolean,
    typeOfNewBookmark: String,
    isFirstTime: Boolean
});

const { t, te } = useI18n();

const saveLabel = computed(() => {
    const type = props.typeOfNewBookmark;
    if (!type || type == 'empty') return t('common.save');
    const key = `bookmark_submit.types.${type}`;
    return t('bookmark_submit.save_type', { type: te(key) ? t(key) : type });
});

defineEmits(['close', 'submit']);
</script>
