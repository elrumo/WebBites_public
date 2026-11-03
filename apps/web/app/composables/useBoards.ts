import type { AutomationCondition } from '~/composables/useAutomations'

/**
 * Composable for board API operations.
 * Thin wrapper around useBackendFetch() — returns raw promises, no store coupling.
 *
 * @example
 * const { fetchBoards, createBoard } = useBoards()
 * const { boards } = await fetchBoards()
 * const { board } = await createBoard({ name: 'My Board', mode: 'manual' })
 */
export const useBoards = () => {
  const { backendFetch } = useBackendFetch()

  const fetchBoards = async (limit = 200) => {
    return await backendFetch<{ success: boolean; boards: any[]; total: number }>('boards', {
      query: { limit }
    })
  }

  const fetchBoard = async (boardId: string, limit = 50, skip = 0) => {
    return await backendFetch<{
      success: boolean
      board: any
      items: any[]
      totalBookmarks: number
    }>(`boards/${boardId}`, {
      query: { limit, skip }
    })
  }

  const createBoard = async (data: {
    name: string
    mode: 'manual' | 'smart' | 'mixed'
    description?: string
    smartRules?: {
      topics: string[]
      confidenceThreshold?: number
      autoApply?: boolean
      includeExisting?: boolean
    }
    /** A smart board's exact conditions, matched alongside (or instead of) AI topics. */
    rule?: { match: 'all' | 'any'; conditions: AutomationCondition[] }
    color?: string
    icon?: string
  }) => {
    return await backendFetch<{ success: boolean; board: any }>('boards', {
      method: 'POST',
      body: data
    })
  }

  /** A folder groups boards and other folders; it holds no bookmarks. */
  const createFolder = async (data: { name: string; parentId?: string | null; icon?: string; color?: string }) => {
    return await backendFetch<{ success: boolean; board: any }>('boards', {
      method: 'POST',
      body: { ...data, kind: 'folder' }
    })
  }

  /**
   * Put `orderedIds` under `parentId` (null = top level) in that order; any of
   * them sitting elsewhere are moved. Send the destination's full child list.
   */
  const reorderBoards = async (parentId: string | null, orderedIds: string[]) => {
    return await backendFetch<{ success: boolean; boards: any[] }>('boards/order', {
      method: 'PUT',
      body: { parentId, orderedIds }
    })
  }

  const updateBoard = async (boardId: string, updates: Record<string, any>) => {
    return await backendFetch<{ success: boolean; board: any }>(`boards/${boardId}`, {
      method: 'PATCH',
      body: updates
    })
  }

  const deleteBoard = async (boardId: string) => {
    return await backendFetch(`boards/${boardId}`, { method: 'DELETE' })
  }

  const addBookmarksToBoard = async (
    boardId: string,
    websiteIds: string[],
    source: 'manual' | 'smart' = 'manual'
  ) => {
    return await backendFetch<{
      success: boolean
      results: Array<{ websiteId: string; status: string }>
      created: number
      total: number
    }>(`boards/${boardId}/bookmarks`, {
      method: 'POST',
      body: { websiteIds, source }
    })
  }

  const removeBookmarkFromBoard = async (boardId: string, websiteId: string) => {
    return await backendFetch(`boards/${boardId}/bookmarks/${websiteId}`, {
      method: 'DELETE'
    })
  }

  /**
   * Copy a collection. Its items and their canvas positions come along by
   * default; its sub-collections and its sharing do not.
   */
  const duplicateBoard = async (
    boardId: string,
    options: { name?: string; includeBookmarks?: boolean } = {}
  ) => {
    return await backendFetch<{ success: boolean; board: any; copiedBookmarks: number }>(
      `boards/${boardId}/duplicate`,
      { method: 'POST', body: options }
    )
  }

  /** Archive or restore. An archived collection keeps its contents and leaves the sidebar. */
  const setBoardArchived = async (boardId: string, archived: boolean) => {
    return await updateBoard(boardId, { archived })
  }

  /** Move into a folder, or to the top level with `null`. */
  const moveBoard = async (boardId: string, parentId: string | null) => {
    return await updateBoard(boardId, { parentId })
  }

  const getBoardsForBookmark = async (bookmarkId: string) => {
    return await backendFetch<{ success: boolean; boards: any[] }>(
      `boards/bookmark/${bookmarkId}`
    )
  }

  // ── Sharing ──────────────────────────────────────────────────────

  type BoardMember = {
    id: string
    /** Only the owner is told who the members are by address. */
    email?: string
    name: string
    role: 'viewer' | 'editor'
    status: 'pending' | 'active'
  }

  type BoardSharing = {
    success: boolean
    visibility: 'private' | 'link'
    shareUrl: string | null
    /** A link made before links could be re-shown; resetting it fixes that. */
    needsRotate: boolean
    owner: { id: string; name: string }
    members: BoardMember[]
  }

  const getBoardSharing = async (boardId: string) => {
    return await backendFetch<BoardSharing>(`boards/${boardId}/sharing`)
  }

  const updateBoardSharing = async (boardId: string, visibility: 'private' | 'link') => {
    return await backendFetch<{ success: boolean; board: any; shareUrl: string | null }>(
      `boards/${boardId}/sharing`,
      { method: 'PATCH', body: { visibility } }
    )
  }

  /** New link; the old one stops working. */
  const rotateShareLink = async (boardId: string) => {
    return await backendFetch<{ success: boolean; shareUrl: string }>(
      `boards/${boardId}/sharing/rotate-token`,
      { method: 'POST' }
    )
  }

  const inviteToBoard = async (boardId: string, invites: Array<{ email: string; role: 'viewer' | 'editor' }>) => {
    return await backendFetch<{ success: boolean; members: BoardMember[]; inviteLinks?: Array<{ email: string; link: string }> }>(
      `boards/${boardId}/members`,
      { method: 'POST', body: { invites } }
    )
  }

  const updateBoardMember = async (boardId: string, memberId: string, role: 'viewer' | 'editor') => {
    return await backendFetch<{ success: boolean; member: BoardMember }>(
      `boards/${boardId}/members/${memberId}`,
      { method: 'PATCH', body: { role } }
    )
  }

  /** `memberId` of `'me'` leaves the board. */
  const removeBoardMember = async (boardId: string, memberId: string) => {
    return await backendFetch(`boards/${boardId}/members/${memberId}`, { method: 'DELETE' })
  }

  const acceptBoardInvite = async (token: string) => {
    return await backendFetch<{ success: boolean; board: any }>('boards/invites/accept', {
      method: 'POST',
      body: { token }
    })
  }

  return {
    getBoardSharing,
    updateBoardSharing,
    rotateShareLink,
    inviteToBoard,
    updateBoardMember,
    removeBoardMember,
    acceptBoardInvite,
    fetchBoards,
    fetchBoard,
    createBoard,
    createFolder,
    reorderBoards,
    updateBoard,
    deleteBoard,
    addBookmarksToBoard,
    removeBookmarkFromBoard,
    getBoardsForBookmark,
    duplicateBoard,
    setBoardArchived,
    moveBoard
  }
}
