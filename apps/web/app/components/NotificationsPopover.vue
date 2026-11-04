<template>
  <UPopover
    v-model:open="open"
    :ui="{ content: 'w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl overflow-hidden' }"
  >
    <!-- The badge lives inside the button rather than in a wrapping UChip /
         UTooltip: nested as-child triggers left the popover with nothing to
         anchor to, and it opened in the window's corner. -->
    <UButton
      variant="ghost"
      color="neutral"
      square
      size="sm"
      :title="$t('notifications.title')"
      class="relative rounded-full hover:shadow-md"
      :class="buttonClass"
      :aria-label="notificationsUnread ? $t('notifications.aria_unread', { count: notificationsUnread }) : $t('notifications.title')"
    >
      <IconBrew icon="bell" :size="20" />
      <span
        v-if="notificationsUnread > 0"
        class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-inverted ring-2 ring-default"
      >
        {{ notificationsUnread > 99 ? '99+' : notificationsUnread }}
      </span>
    </UButton>

    <template #content>
      <div class="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h3 class="text-sm font-semibold">{{ $t('notifications.title') }}</h3>
        <UButton
          v-if="notificationsUnread > 0"
          size="xs"
          color="neutral"
          variant="link"
          :label="$t('notifications.mark_all_read')"
          @click="markNotificationsRead('all')"
        />
      </div>

      <div class="max-h-[min(26rem,60vh)] overflow-y-auto pb-2">
        <template v-for="group in groups" :key="group.label">
          <p
            v-if="group.items.length && groups.filter(g => g.items.length).length > 1"
            class="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted"
          >
            {{ group.label }}
          </p>

          <button
            v-for="notification in group.items"
            :key="notification.id"
            type="button"
            class="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-elevated focus-visible:bg-elevated focus:outline-none"
            @click="openNotification(notification)"
          >
            <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-muted">
              <UIcon :name="ICONS[notification.type] ?? 'i-tabler-bell'" class="h-4 w-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm leading-snug" :class="notification.readAt ? 'text-muted' : 'text-default'">
                {{ sentence(notification) }}
              </span>
              <span class="block text-xs text-muted mt-0.5">{{ relativeDate(notification.createdAt) }}</span>
            </span>
            <span
              v-if="!notification.readAt"
              class="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"
              :aria-label="$t('notifications.unread')"
            />
          </button>
        </template>

        <p v-if="!notifications.length" class="px-4 py-6 text-center text-sm text-muted">
          {{ $t('notifications.empty') }}
        </p>
      </div>
    </template>
  </UPopover>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { relativeDate } from '~/utils/relativeDate'

defineProps({
  /** Extra classes for the bell button (the mobile bar styles its own). */
  buttonClass: { type: [String, Array, Object], default: '' }
})

const { t } = useI18n()
const store = useStore()
const { notifications, notificationsUnread, boards, activeBoard } = storeToRefs(store)
const { markNotificationsRead, selectBoard, showAlert } = store

const open = ref(false)

const ICONS = {
  board_shared: 'i-tabler-share',
  role_changed: 'i-tabler-user-cog',
  board_unshared: 'i-tabler-user-minus',
  item_added: 'i-tabler-plus',
  item_edited: 'i-tabler-pencil',
  item_removed: 'i-tabler-minus',
  member_joined: 'i-tabler-user-plus',
  member_left: 'i-tabler-logout'
}

const groups = computed(() => [
  { label: t('notifications.group_new'), items: notifications.value.filter(n => !n.readAt) },
  { label: t('notifications.group_earlier'), items: notifications.value.filter(n => n.readAt) }
])

/** "Ana added 3 bookmarks to “Design refs”" */
const sentence = (n) => {
  const params = { who: n.actorName || t('notifications.someone'), board: n.boardName, title: n.titles?.[0], count: n.count > 1 ? n.count : 1 }
  switch (n.type) {
    case 'board_shared':
    case 'role_changed':
    case 'board_unshared':
    case 'member_joined':
    case 'member_left':
      return t(`notifications.sentence.${n.type}`, params)
    case 'item_added':
    case 'item_edited':
    case 'item_removed':
      // One titled bookmark names it; otherwise "a bookmark" / "{count} bookmarks".
      return n.count <= 1 && params.title
        ? t(`notifications.sentence.${n.type}_titled`, params)
        : t(`notifications.sentence.${n.type}`, params, params.count)
    default: return t('notifications.sentence.default', params)
  }
}

// Looking at the list is reading it: whatever was in view when it closes is read.
watch(open, (isOpen, wasOpen) => {
  if (wasOpen && !isOpen) markNotificationsRead(notifications.value.filter(n => !n.readAt).map(n => n.id))
})

const openNotification = (n) => {
  open.value = false
  if (n.type === 'board_unshared') return
  const board = boards.value.find(b => b.id === n.boardId)
  if (!board) {
    showAlert({ message: t('notifications.board_unavailable') })
    return
  }
  // Picking the open board again would close it.
  if (activeBoard.value?.id !== board.id) selectBoard(board)
}
</script>
