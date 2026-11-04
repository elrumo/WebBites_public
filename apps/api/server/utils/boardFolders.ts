/**
 * Folders arrived after boards could nest under boards. Only a folder may be a
 * parent now, so every board that has children is wrapped in a folder of the
 * same name: the folder takes the board's place in the tree, and the board
 * (still holding its bookmarks) and its former children sit inside it.
 * Pure, so it is testable without Parse; scripts/migrate-board-folders.ts
 * applies the result.
 */
export interface TreeRow {
  id: string
  parentId: string | null
  path: string[]
  sortIndex: number
}

export interface FolderWrap {
  /** The board that had children. */
  boardId: string
  /** Placeholder id for the new folder; the caller swaps in the real one. */
  folderId: string
  /** Where the folder goes: the board's old place. */
  parentId: string | null
  path: string[]
  sortIndex: number
}

/** Returns the wraps in order plus every row's new place (including the wrapped boards). */
export function planFolderWraps(rows: TreeRow[]): { wraps: FolderWrap[]; rows: Map<string, TreeRow> } {
  const byId = new Map(rows.map((row) => [row.id, { ...row, path: [...row.path] }]))
  const wraps: FolderWrap[] = []
  // Shallowest first: wrapping a board shifts its whole subtree one level down,
  // and the deeper boards are looked at after that.
  const order = [...byId.values()].sort((a, b) => a.path.length - b.path.length)
  for (const board of order) {
    const children = [...byId.values()].filter((row) => row.parentId === board.id)
    if (!children.length) continue
    const folderId = `new-folder-${wraps.length}`
    wraps.push({ boardId: board.id, folderId, parentId: board.parentId, path: [...board.path], sortIndex: board.sortIndex })
    const depth = board.path.length
    // Everything under the board now hangs off the folder instead.
    for (const row of byId.values()) {
      if (row.path[depth] === board.id && row.path.length > depth) row.path[depth] = folderId
    }
    children.sort((a, b) => a.sortIndex - b.sortIndex)
    board.parentId = folderId
    board.path = [...board.path, folderId]
    board.sortIndex = 0
    children.forEach((child, index) => {
      child.parentId = folderId
      child.sortIndex = index + 1
    })
  }
  return { wraps, rows: byId }
}
