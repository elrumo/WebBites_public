<template>
    <Transition name="slide-down">
        <div
            v-if="alert.show"
            class="fixed z-[99999] w-[calc(100vw-2rem)] max-w-sm"
            :class="alertPosition"
        >
            <div
                class="alert-card"
                :class="typeof alert.onClickFunction == 'function' ? 'cursor-pointer' : ''"
                :role="isError ? 'alert' : 'status'"
                @click="handleClick"
            >
                <span class="alert-card__icon" :class="tone.chip">
                    <UIcon
                        :name="tone.icon"
                        class="size-[18px]"
                        :class="alert.loader ? 'animate-spin' : ''"
                    />
                </span>

                <div class="alert-card__body">
                    <p
                        class="alert-card__message"
                        v-html="markedText(alert.message)"
                    />

                    <div
                        v-if="alert.description"
                        class="alert-card__description"
                        v-html="alert.description"
                    />

                    <!-- A confirm alert blocks whoever is awaiting `confirmAlert`,
                         so both buttons must settle the promise. -->
                    <div v-if="alert.confirm" class="flex gap-2 mt-3">
                        <UButton size="xs" color="primary" @click.stop="answer(true)">
                            {{ alert.confirm.confirmLabel || $t('common.save') }}
                        </UButton>
                        <UButton size="xs" color="neutral" variant="ghost" @click.stop="answer(false)">
                            {{ alert.confirm.cancelLabel || $t('common.cancel') }}
                        </UButton>
                    </div>
                </div>

                <UButton
                    v-if="alert.showCloseButton"
                    icon="i-tabler-x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="alert-card__close"
                    :aria-label="$t('common.close')"
                    @click.stop="answer(false)"
                />
            </div>
        </div>
    </Transition>
</template>

<script setup>
    import { useStore } from '~/stores/myStore'

    const store = useStore()
    const { markedText } = store

    const alert = computed(() => store.alert)

    // `danger` is the older spelling of `error` and is still used by many callers.
    const isError = computed(() => ['error', 'danger'].includes(alert.value.type))

    const tone = computed(() => {
        if (alert.value.loader) {
            return { icon: 'i-tabler-loader-2', chip: 'alert-card__icon--neutral' }
        }

        switch (alert.value.type) {
            case 'success':
                return { icon: 'i-tabler-circle-check-filled', chip: 'alert-card__icon--success' }
            case 'error':
            case 'danger':
                return { icon: 'i-tabler-alert-circle-filled', chip: 'alert-card__icon--error' }
            case 'warning':
                return { icon: 'i-tabler-alert-triangle-filled', chip: 'alert-card__icon--warning' }
            default:
                return { icon: 'i-tabler-info-circle-filled', chip: 'alert-card__icon--neutral' }
        }
    })

    const alertPosition = computed(() => {
        switch (alert.value?.position) {
            case 'top-right':
                return 'top-12 right-1/2 md:right-4 translate-x-1/2 md:translate-x-0'
            case 'top-center':
                return 'top-12 left-1/2 -translate-x-1/2'
            default:
                return 'top-12 left-1/2 -translate-x-1/2'
        }
    })

    watch(() => alert.value, (val) => {
        if (val.show && !val.permanent) {
            setTimeout(() => {
                alert.value.type = 'success'
                alert.value.show = false
                alert.value.onClickFunction = null
            }, val.timeOnScreen)
        }
    }, { deep: true })

    const handleClick = () => {
        if (typeof alert.value.onClickFunction === 'function') {
            alert.value.onClickFunction()
        }
    }

    /** Closes the alert, settling a pending `confirmAlert` with the answer. */
    const answer = (confirmed) => {
        const pending = alert.value.confirm
        alert.value.confirm = null
        alert.value.show = false
        pending?.resolve?.(confirmed)
    }

</script>

<style scoped>
@reference "../assets/css/tailwind.css";

/* A translucent material in the manner of iOS and macOS notifications: the
   page shows through, heavily blurred and saturated, under a hairline edge
   that catches the light. Rounded like the app's modals. The type is carried
   by the icon chip alone. */
.alert-card {
    @apply flex items-start gap-3 p-3 pr-2
           rounded-2xl border border-white/60 dark:border-white/10
           bg-white/75 dark:bg-neutral-800/70
           backdrop-blur-3xl backdrop-saturate-[1.8]
           shadow-lg shadow-black/10 dark:shadow-black/40;
}

.alert-card__icon {
    @apply flex size-8 shrink-0 items-center justify-center rounded-xl;
}

.alert-card__icon--neutral {
    @apply bg-black/5 text-neutral-600 dark:bg-white/10 dark:text-neutral-300;
}

.alert-card__icon--error {
    @apply bg-red-500/15 text-red-600 dark:bg-red-500/20 dark:text-red-400;
}

.alert-card__icon--warning {
    @apply bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400;
}

/* The accent lives in Nuxt UI's theme layer, which `@reference` does not
   load, so it is reached through the variable (see TiptapSlashMenu). */
.alert-card__icon--success {
    background-color: color-mix(in oklab, var(--color-primary-500) 18%, transparent);
    color: var(--color-primary-600);
}

/* Not `:global(.dark) …`: Vue compiles that to a bare `.dark {}` rule, which
   turned every dark-themed element on the site green. */
.dark .alert-card__icon--success {
    color: var(--color-primary-400);
}

.alert-card__body {
    @apply flex min-w-0 flex-1 flex-col self-center py-1;
}

.alert-card__message {
    @apply m-0 text-sm font-semibold leading-5 text-neutral-900 dark:text-neutral-100 break-words;
}

.alert-card__description {
    @apply mt-0.5 text-xs leading-4 text-neutral-600 dark:text-neutral-300;
}

.alert-card__close {
    @apply shrink-0 rounded-full text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100;
}
</style>
