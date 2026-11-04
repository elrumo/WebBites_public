export type BoardNotification = {
  id: string
  type:
    | 'board_shared' | 'role_changed' | 'board_unshared'
    | 'item_added' | 'item_edited' | 'item_removed'
    | 'member_joined' | 'member_left'
  boardId: string
  boardName: string
  actorName: string
  /** How many items a coalesced `item_*` row stands for. */
  count: number
  titles: string[]
  readAt: string | null
  createdAt: string
}

/**
 * Notification history for the bell.
 * Thin wrapper around useBackendFetch() — returns raw promises, no store coupling.
 */
export const useNotifications = () => {
  const { backendFetch } = useBackendFetch()

  const fetchNotifications = async (limit = 30, skip = 0) => {
    return await backendFetch<{
      success: boolean
      notifications: BoardNotification[]
      unreadCount: number
      total: number
    }>('me/notifications', { query: { limit, skip } })
  }

  const markNotificationsRead = async (target: { ids: string[] } | { all: true }) => {
    return await backendFetch<{ success: boolean; unreadCount: number }>('me/notifications/read', {
      method: 'POST',
      body: target
    })
  }

  return { fetchNotifications, markNotificationsRead }
}
