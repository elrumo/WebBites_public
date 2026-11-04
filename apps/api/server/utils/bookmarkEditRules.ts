/**
 * The field rules for editing a bookmark from outside the apps (the MCP
 * server). Pure, so they are tested on their own (`npm run test:bookmarkEdits`).
 */

export const MAX_TITLE_LENGTH = 300
export const MAX_NOTE_LENGTH = 5000
export const MAX_TAG_LENGTH = 64
export const MAX_TAGS = 50

/**
 * Trimmed, length-capped, de-duplicated without regard to case (the first
 * spelling wins, as the tag facet would collapse them anyway), empties dropped.
 */
export function normaliseTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out.slice(0, MAX_TAGS)
}

/**
 * The tag list after an edit: `tags` replaces the list outright, then
 * `addTags` and `removeTags` apply on top (removal ignores case).
 */
export function applyTagEdits(
  current: unknown,
  { tags, addTags, removeTags }: { tags?: unknown; addTags?: unknown; removeTags?: unknown },
): string[] {
  let next = tags !== undefined ? normaliseTags(tags) : normaliseTags(current)
  if (addTags !== undefined) next = normaliseTags([...next, ...normaliseTags(addTags)])
  if (removeTags !== undefined) {
    const drop = new Set(normaliseTags(removeTags).map((tag) => tag.toLowerCase()))
    next = next.filter((tag) => !drop.has(tag.toLowerCase()))
  }
  return next
}

export interface BookmarkEdits {
  title?: string
  note?: string
  tags?: string[]
  addTags?: string[]
  removeTags?: string[]
  pinned?: boolean
}

/** The Parse columns an edit writes, or null when it changes nothing. */
export function editsToColumns(current: { tags?: unknown }, edits: BookmarkEdits): Record<string, unknown> | null {
  const columns: Record<string, unknown> = {}
  if (typeof edits.title === 'string') columns.siteTitle = edits.title.trim().slice(0, MAX_TITLE_LENGTH)
  if (typeof edits.note === 'string') columns.siteNotes = edits.note.trim().slice(0, MAX_NOTE_LENGTH)
  if (edits.tags !== undefined || edits.addTags !== undefined || edits.removeTags !== undefined) {
    columns.tags = applyTagEdits(current.tags, edits)
  }
  if (typeof edits.pinned === 'boolean') columns.pinned = edits.pinned
  return Object.keys(columns).length ? columns : null
}
