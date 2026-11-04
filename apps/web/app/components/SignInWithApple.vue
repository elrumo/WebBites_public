<template>
    <UButton
        color="neutral"
        variant="solid"
        :size="compact ? 'xs' : 'lg'"
        class="rounded-full font-semibold w-fit mx-auto"
        :loading="loadingSignInWithApple"
        @click="signInWithApple"
    >
        <!-- The spinner takes the logo's place rather than sitting beside it,
             so the label does not shift when the button starts loading. -->
        <UIcon
            v-if="!loadingSignInWithApple"
            name="i-fa6-brands-apple"
            :class="{
                'w-5 h-5': !compact,
                'w-4 h-4 -translate-y-px': compact
            }"
        />
        {{ $t('auth.signInWithApple') }}
    </UButton>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { useStore } from '~/stores/myStore';

const store = useStore();

const {
  signInWithApple
} = store;

const {
    loadingSignInWithApple
} = storeToRefs(store);

const props = defineProps({
    compact: {
        type: Boolean,
        default: false
    }
})

/**
 * The spinner stays on until the page is gone, so a page brought back from
 * the back-forward cache — the reader backed out of Apple's sheet — would
 * come back still spinning. `persisted` is only true for that restore.
 */
const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) store.loadingSignInWithApple = false;
};

onMounted(() => window.addEventListener('pageshow', onPageShow));
onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow));

</script>
