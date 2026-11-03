<template>
    <!-- Phone only; the desktop top bar keeps its own row of controls.

         The row and the pills are siblings rather than one wrapped block: a
         sticky element only holds within its own parent's box, and a wrapper
         that ends under the pills took the bar off the screen on the first
         scroll. As children of the grid's own column, the bar stays. -->
    <div
        class="mobile-top-bar-row"
        :class="{ 'mobile-top-bar-row--scrolled': scrolled }"
    >
        <!-- The way into the sidebar, under the same icon the desktop bar
             uses for it. -->
        <UButton
            square
            variant="ghost"
            color="neutral"
            class="mobile-top-bar-button"
            :icon="showSideBar ? 'i-tabler-layout-sidebar-filled' : 'i-tabler-layout-sidebar'"
            :aria-label="$t('mobile_top_bar.library')"
            @click="showSideBar = !showSideBar"
        />

        <h1 class="mobile-top-bar-title">
            {{ title }}
        </h1>

        <!-- Everything you do to the grid, as one menu: how it is laid out,
             what a card shows, and the way into settings, trash and feedback.
             Two separate buttons for viewing and settings is one more than a
             phone has room for. -->
        <NotificationsPopover
            v-if="notificationsTotal > 0"
            button-class="shrink-0 w-9 h-9 bg-white/80 dark:bg-neutral-800/80 ring-1 ring-neutral-200/60 dark:ring-neutral-700/60 shadow-sm"
        />

        <UPopover
            v-model:open="menuOpen"
            :ui="{ content: 'w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl' }"
        >
            <UButton
                square
                variant="ghost"
                color="neutral"
                class="mobile-top-bar-button"
                icon="i-heroicons-ellipsis-horizontal"
                :aria-label="$t('mobile_top_bar.more')"
            />

            <template #content>
                <div class="mobile-menu">
                    <ViewOptionsPanel class="p-4 pb-3" />

                    <div class="mobile-menu-divider" />

                    <div class="mobile-menu-actions">
                        <button
                            type="button"
                            class="mobile-menu-item"
                            @click="runAndClose(() => showSettingsModal = true)"
                        >
                            <IconBrew icon="settings" :size="18" />
                            <span>{{ $t('navigation.settings') }}</span>
                        </button>

                        <button
                            type="button"
                            class="mobile-menu-item"
                            @click="runAndClose(() => showTrashModal = true)"
                        >
                            <IconBrew icon="trash" :size="18" />
                            <span>{{ $t('mobile_top_bar.trash') }}</span>
                        </button>

                        <button
                            type="button"
                            class="mobile-menu-item"
                            @click="runAndClose(() => router.push('/feedback'))"
                        >
                            <IconBrew icon="email" :size="18" />
                            <span>{{ $t('navigation.feedback') }}</span>
                        </button>
                    </div>
                </div>
            </template>
        </UPopover>
    </div>

    <!-- The type pills scroll away with the grid rather than staying pinned:
         they are a filter, not chrome. -->
    <BookmarkTypes class="mobile-top-bar-types" :horizontal="true" />
</template>

<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()
const router = useRouter()

const menuOpen = ref(false)

const {
    scrolled,
    showSideBar,
    showSettingsModal,
    showTrashModal,
    activeBoard,
    rssScope,
    privateScope,
    notificationsTotal
} = storeToRefs(store)

const { t } = useI18n()

/** What the grid is showing right now — the board, the feed, Private, or everything. */
const title = computed(() => {
    if (privateScope.value) return t('bookmarks.hide.private_section')
    if (activeBoard.value) return activeBoard.value.name || activeBoard.value.title || t('mobile_top_bar.board')
    if (rssScope.value !== null) return store.rssScopeTitle
    return t('mobile_top_bar.everything')
})

const runAndClose = (action) => {
    menuOpen.value = false
    action()
}

defineOptions({
    name: 'MobileTopBar'
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

/* Sticky rather than fixed: it rides the page scroll like the native bar and
   never needs the grid to reserve room for it. */
.mobile-top-bar-row{
    @apply
        hidden
        sticky top-0 z-[6]
        flex-row items-center gap-2
        -mx-3 px-3 py-2
        transition-all duration-200
    ;

    @media screen and (max-width: 768px){
        @apply flex;
    }
}

.mobile-top-bar-row--scrolled{
    @apply
        bg-white/70 dark:bg-neutral-900/80
        backdrop-blur-2xl
        shadow-sm shadow-neutral-500/5 dark:shadow-black/20
    ;
}

.mobile-top-bar-button{
    @apply
        shrink-0
        w-9 h-9
        items-center justify-center
        rounded-full
        bg-white/80 dark:bg-neutral-800/80
        ring ring-1 ring-neutral-200/60 dark:ring-neutral-700/60
        shadow-sm
    ;
}

.mobile-top-bar-title{
    @apply
        flex-1 min-w-0
        m-0
        text-base font-semibold text-center truncate
    ;
}

.mobile-top-bar-types{
    @apply hidden -mx-3;

    @media screen and (max-width: 768px){
        @apply block;
    }
}

.mobile-menu{
    @apply flex flex-col;
}

.mobile-menu-divider{
    @apply h-px mx-4 bg-neutral-200 dark:bg-neutral-700;
}

.mobile-menu-actions{
    @apply flex flex-col gap-0.5 p-2;
}

.mobile-menu-item{
    @apply
        flex flex-row items-center gap-3
        w-full px-3 h-10
        text-sm text-left
        rounded-xl
        transition-colors
        hover:bg-neutral-100 dark:hover:bg-neutral-700/60
        active:bg-neutral-200 dark:active:bg-neutral-700
    ;
}
</style>
