/**
 * Meilisearch filter clauses built from typed arguments, for callers that must
 * never pass a filter string through from outside: the MCP server takes `tags`
 * and `type` from a language model, and a model can be talked into writing
 * anything. Pure, so the escaping is tested (`npm run test:searchFilters`).
 *
 * Each clause becomes its own element of Meilisearch's array syntax next to the
 * mandatory scope from `buildFilter`, so even a value that escaped its quotes
 * could not widen the search past the user's own bookmarks.
 */

/** A Meilisearch string literal: double-quoted, with `\` and `"` escaped. */
export function meiliQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** One clause per tag (all must match) and one for the type. */
export function typedSearchFilters({ tags, type }: { tags?: string[]; type?: string }): string[] {
  const clauses: string[] = []
  for (const tag of tags ?? []) {
    const trimmed = tag.trim()
    if (trimmed) clauses.push(`tags = ${meiliQuote(trimmed)}`)
  }
  if (type?.trim()) clauses.push(`type = ${meiliQuote(type.trim())}`)
  return clauses
}

/**
 * Whether a bookmark saved at `createdAt` falls in [after, before). Dates are
 * compared after parsing, never as strings: the index holds `createdAt` as
 * whatever the row serialised to, which is why this runs on the hits rather
 * than inside the Meilisearch filter.
 */
export function savedWithin(createdAt: unknown, after?: string, before?: string): boolean {
  if (!after && !before) return true
  const raw = (createdAt as any)?.iso ?? createdAt
  const time = raw instanceof Date ? raw.getTime() : Date.parse(String(raw ?? ''))
  if (Number.isNaN(time)) return false
  if (after && time < Date.parse(after)) return false
  if (before && time >= Date.parse(before)) return false
  return true
}

/**
 * Opaque page cursors. They only carry an offset, but callers treat them as
 * opaque so the paging scheme can change without changing the tools.
 */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url')
}

/** The offset in a cursor, or 0 for none. Throws on a cursor we didn't make. */
export function decodeOffsetCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0
  let offset: unknown
  try {
    offset = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))?.o
  } catch {
    throw new Error('Invalid cursor')
  }
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error('Invalid cursor')
  }
  return offset
}
