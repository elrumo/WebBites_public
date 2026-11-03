<template>
    <Transition name="slide-up">
        <div
            v-if="showCardOptions || checked"
            :class="{ 'reactions-wrapper': true, 'checked': checked }"
        >
            <UCheckbox
                :model-value="checked"
                :ui="{ base: 'size-5 rounded-full cursor-pointer shadow-md' }"
                @update:model-value="$emit('update:checked', $event)"
            />

            <div class="reactions-content">
                <UButton
                    variant="ghost"
                    square
                    size="xs"
                    @click="setPinned(website, isPinned ? 'pin-' + website.objectId + 'pinned' : 'pin-' + website.objectId, $event)"
                >
                    <UIcon
                        :name="website.pinned ? 'i-tabler-pin-filled' : 'i-tabler-pin'"
                        :class="'reactions-content-item ' + (website.pinned ? '!text-yellow-600 !opacity-100' : '')"
                        :id="website.pinned ? 'pin-' + website.objectId + 'pinned' : 'pin-' + website.objectId"
                        class="w-5 h-5"
                    />
                </UButton>

                <BookmarkOptionsDropdown
                    :website="website"
                />
            </div>
        </div>
    </Transition>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const store = useStore();
const { isMobile } = storeToRefs(store);
const { setPin, showAlert } = store;

const emit = defineEmits(['update:checked']);

const props = defineProps({
    website: {
        type: Object,
        required: true
    },
    checked: {
        type: Boolean,
        required: true
    },
    showCardOptions: {
        type: Boolean,
        required: true
    },
    isPinned: {
        type: Boolean,
        required: true
    },
    // actionsItems: {
    //     type: Array,
    //     required: true
    // }
});

const setPinned = async (website, target, event) => {
    const isSitePinned = website.pinned;
    setPin(website);

    if (isSitePinned) {
        showAlert({
          message: t('bookmarks.unpin_success'),
          loader: true
        });
    } else {
        showAlert({
          message: t('bookmarks.pin_success'),
          loader: true
        });
    }
};
</script>
