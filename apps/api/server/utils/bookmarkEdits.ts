import Parse from 'parse/node.js'
import { initParseForBoards } from './boardUtils'
import { editsToColumns, type BookmarkEdits } from './bookmarkEditRules'
import { softDeleteBookmarks } from '../routes/batchDelete.post.js'

/**
 * Editing and trashing one user's bookmarks with the master key, for the MCP
 * server. Every query is scoped to the owner and leaves out bookmarks in the
 * trash and hidden ones — at either level, like the developer API: a token
 * held by an assistant is a wider audience than the user's own screen.
 *
 * Search is kept in step by the Parse afterSave trigger, as it is for the
 * apps' own edits; trashing goes through softDeleteBookmarks so the quota,
 * Meilisearch, Algolia and board memberships agree.
 */

const TRASH_DAYS = 30

function ownedVisibleQuery(userId: string, id: string): Parse.Query {
  const query = new Parse.Query('websites')
  query.equalTo('objectId', id)
  query.equalTo('user', { __type: 'Pointer', className: '_User', objectId: userId } as any)
  query.notEqualTo('isDeleted', true)
  query.notContainedIn('hiddenFrom', ['library', 'everywhere'])
  return query
}

/** The user's own, visible bookmark, or null. */
export async function findVisibleBookmark(userId: string, id: string): Promise<Parse.Object | null> {
  initParseForBoards()
  return (await ownedVisibleQuery(userId, id).first({ useMasterKey: true })) ?? null
}

/**
 * Apply `edits`. Returns the saved row, null when there is no such bookmark,
 * or the row unchanged when the edit changes nothing (the caller words that).
 */
export async function updateBookmarkFields(
  userId: string,
  id: string,
  edits: BookmarkEdits,
): Promise<{ row: Parse.Object; changed: boolean } | null> {
  const row = await findVisibleBookmark(userId, id)
  if (!row) return null
  const columns = editsToColumns({ tags: row.get('tags') }, edits)
  if (!columns) return { row, changed: false }
  for (const [column, value] of Object.entries(columns)) row.set(column, value)
  await row.save(null, { useMasterKey: true })
  return { row, changed: true }
}

/** Move one bookmark to the trash. Null when there is no such bookmark. */
export async function trashBookmarkForUser(
  userId: string,
  id: string,
): Promise<{ id: string; restorableUntil: string } | null> {
  const row = await findVisibleBookmark(userId, id)
  if (!row) return null
  await softDeleteBookmarks([row])
  return { id: row.id, restorableUntil: new Date(Date.now() + TRASH_DAYS * 86400_000).toISOString() }
}
