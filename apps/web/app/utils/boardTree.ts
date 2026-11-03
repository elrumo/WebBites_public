/**
 * The sidebar's tree of folders and boards, as pure functions.
 *
 * Only a folder may contain anything; a board is always a leaf. Every drag in
 * the sidebar reduces to "these ids, in this order, under this parent", which
 * is what `PUT /v1/boards/order` takes, and `applyMove` mirrors it locally so
 * the sidebar updates before the request returns.
 */
export interface TreeBoard {
  id: string
  kind?: 'board' | 'folder'
  parentId?: string | null
  /** Ancestor ids, root first. */
  path?: string[]
  sortIndex?: number
  /** Absent means owner; boards shared with you are drawn at the top and are not yours to move. */
  role?: string
}

export type DropZone = 'before' | 'after' | 'inside'

export const isFolder = (board: Pick<TreeBoard, 'kind'>) => board.kind === 'folder'
const isOwned = (board: TreeBoard) => !board.role || board.role === 'owner'

/** The owner's children of `parentId`, in order. */
export function childrenOf<T extends TreeBoard>(boards: T[], parentId: string | null): T[] {
  return boards
    .filter(b => isOwned(b) && (b.parentId ?? null) === parentId)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
}

/** Whether `dragId` may be dropped at `zone` of `targetId`. */
export function canDrop(boards: TreeBoard[], dragId: string, targetId: string, zone: DropZone): boolean {
  const drag = boards.find(b => b.id === dragId)
  const target = boards.find(b => b.id === targetId)
  if (!drag || !target || drag.id === target.id) return false
  if (!isOwned(drag) || !isOwned(target)) return false
  // Into its own subtree would cut the branch off from the tree.
  if ((target.path ?? []).includes(drag.id)) return false
  return zone !== 'inside' || isFolder(target)
}

/** The destination and its full child order for a drop, or null if nothing would change. */
export function planDrop(
  boards: TreeBoard[], dragId: string, targetId: string, zone: DropZone
): { parentId: string | null; orderedIds: string[] } | null {
  if (!canDrop(boards, dragId, targetId, zone)) return null
  const drag = boards.find(b => b.id === dragId)!
  const target = boards.find(b => b.id === targetId)!

  let parentId: string | null
  let ids: string[]
  if (zone === 'inside') {
    parentId = target.id
    ids = [...childrenOf(boards, parentId).map(b => b.id).filter(id => id !== dragId), dragId]
  } else {
    // A parent that is not in the list (archived) leaves the row at the top level, as the sidebar draws it.
    parentId = target.parentId && boards.some(b => b.id === target.parentId) ? target.parentId : null
    ids = childrenOf(boards, parentId).map(b => b.id).filter(id => id !== dragId)
    ids.splice(ids.indexOf(targetId) + (zone === 'after' ? 1 : 0), 0, dragId)
  }

  const unchanged = (drag.parentId ?? null) === parentId
    && childrenOf(boards, parentId).map(b => b.id).join() === ids.join()
  return unchanged ? null : { parentId, orderedIds: ids }
}

/** The list after `orderedIds` were put under `parentId`; descendants of a moved row follow it. */
export function applyMove<T extends TreeBoard>(boards: T[], parentId: string | null, orderedIds: string[]): T[] {
  const parent = parentId ? boards.find(b => b.id === parentId) : null
  const path = parent ? [...(parent.path ?? []), parent.id] : []
  // Siblings that were already here keep their subtrees as they are.
  const reparented = new Set(boards.filter(b => orderedIds.includes(b.id) && (b.parentId ?? null) !== parentId).map(b => b.id))
  return boards.map((board) => {
    const index = orderedIds.indexOf(board.id)
    if (index !== -1) return { ...board, parentId, path, sortIndex: index }
    // Below a moved row: keep the part of the path from that row down.
    const from = (board.path ?? []).findIndex(id => reparented.has(id))
    if (from === -1) return board
    return { ...board, path: [...path, ...board.path!.slice(from)] }
  })
}
