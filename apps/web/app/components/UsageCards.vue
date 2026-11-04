<template>
    <div class="grid grid-cols-2 gap-3">
        <UCard :ui="{ body: 'px-2 py-2 sm:p-3 h-full' }">
            <div class="flex flex-col gap-1 h-fit m-auto">
                <p class="text-xs text-gray-500">
                    {{ $t('common.bookmarks') }}
                </p>

                <div 
                    class="flex flex-col"
                    :class="{'text-red-600': bookmarks?.exceeded}"
                >
                    <span class="font-medium">
                        {{ bookmarks?.used ?? 0 }} / {{ limitLabel(bookmarks) }}
                    </span>
                    
                    <span 
                        v-if="usageLeft.bookmarks != 0" 
                        class="text-xs text-gray-400" 
                        @click="showSettingsModal = false; showUpgradeModal = true"
                    >
                        {{ usageLeft?.bookmarks >0 ? `${remainingLabel(bookmarks)} ${$t('common.remaining')}` : $t('upgrade_modal.upgrade_to_add_more') }}
                    </span>

                    <UButton
                        v-if="showUpgradeButton && canUpgrade && usageLeft.bookmarks <= 0" 
                        color="red"
                        size="xs"
                        class="!mt-2 p-1 px-2 w-fit -ml-1"
                        @click="showSettingsModal = false; showUpgradeModal = true"
                        variant="ghost"
                    >
                        {{ $t('common.upgrade') }}
                    </UButton>
                </div>
            </div>
        </UCard>

        <UCard :ui="{ body: 'px-2 py-2 sm:p-3 h-full' }">
            <div class="flex flex-col gap-1 h-fit m-auto">
                <p class="text-xs text-gray-500">
                    {{ $t('bookmark.audio_generation') }}
                </p>
                <div class="flex flex-col">
                    <span class="font-medium" :class="{'text-red-600': audio?.exceeded}">
                        {{ audio?.used ?? 0 }} / {{ limitLabel(audio) }} <small>{{ $t('common.month') }}</small>
                    </span>

                    <span v-if="usageLeft.audio != 0" class="text-xs text-gray-400" @click="showSettingsModal = false; showUpgradeModal = true">
                        {{ remainingLabel(audio) }} {{ $t('common.remaining') }}
                        <span v-if="canUpgrade" class="font-light text-xs hover:underline cursor-pointer">- {{ $t('common.upgrade') }} </span>
                    </span>

                    <UButton
                        v-if="showUpgradeButton && canUpgrade && usageLeft.audio <= 0" 
                        color="red"
                        size="xs"
                        class="!mt-2 p-1 px-2 w-fit -ml-1"
                        variant="ghost"
                        @click="showSettingsModal = false; showUpgradeModal = true"
                    >
                        
                    </UButton>
                </div>
            </div>
        </UCard>
    </div>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';

/**
 * Both meters come from `GET /v1/me/entitlements`, which measures each count
 * against the limit the user's plan actually grants. The card used to pair a
 * count from the `usage` column with a limit read off the plan pointer and
 * subtract one from the other, which produced `NaN` whenever either side was
 * missing and had no way to express an unlimited allowance.
 */

const store = useStore();

const {
  usage,
  usageLeft,
  userPlan,
  billingEnabled,
  showUpgradeModal,
  showSettingsModal
} = storeToRefs(store);

const props = defineProps({
    showUpgradeButton: {
        type: Boolean,
        default: true
    }
})

const bookmarks = computed(() => usage.value?.bookmarks);
const audio = computed(() => usage.value?.audio);

/** Plus is the only paid plan, so a paying user has nothing to upgrade to. */
const canUpgrade = computed(() => billingEnabled.value && !userPlan.value?.isPaid);

/**
 * `limit` and `remaining` are null on an unlimited allowance, so there is no
 * number to print. '∞' needs no translation.
 */
const limitLabel = (quota) => {
  if (!quota) return '—';
  return quota.unlimited ? '∞' : quota.limit;
};

const remainingLabel = (quota) => {
  if (!quota) return 0;
  return quota.unlimited ? '∞' : (quota.remaining ?? 0);
};

</script>
