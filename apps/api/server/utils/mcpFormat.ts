/**
 * The shapes MCP tools return (see `outputs` in docs/mcp-tools.json), built
 * from Parse rows and search hits. Pure, so they are tested without Parse
 * (`npm run test:mcpFormat`): a row is anything with an `id` and a `get`.
 *
 * What goes in is deliberately small — no images, files, colours or HTML. An
 * assistant reads all of it into its context window, and everything here is
 * text somebody else wrote, so the less of it the better.
 */

export interface RowLike {
  id: string
  get(name: string): any
  createdAt?: Date
}

export interface BookmarkSummary {
  id: string
  url: string | null
  title: string
  description: string | null
  type: string
  tags: string[]
  note: string | null
  summary: string | null
  pinned: boolean
  saved_at: string | null
  web_url: string
}

export interface BoardSummary {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  bookmark_count: number | null
  mode: 'manual' | 'smart' | 'mixed'
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Note HTML → readable plain text: block ends become newlines, tags go, entities decode. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|blockquote|pre|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, entity: string) => {
      const lower = entity.toLowerCase()
      if (ENTITIES[lower] !== undefined) return ENTITIES[lower]
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : lower.startsWith('#') ? parseInt(lower.slice(1), 10) : NaN
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** At most `max` characters, cut at a word boundary where one is near. */
export function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return { text: `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated: true }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** ISO 8601 from a Date, a Parse `{ __type: 'Date', iso }`, an ISO string or epoch ms. */
export function isoDate(value: unknown): string | null {
  if (value == null || value === '') return null
  const raw = (value as any)?.iso ?? value
  const time = raw instanceof Date ? raw.getTime() : typeof raw === 'number' ? raw : Date.parse(String(raw))
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export function aiTldr(aiSummary: unknown): string | null {
  return text((aiSummary as any)?.tldr)
}

function hostname(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

export function bookmarkWebUrl(website: string, id: string): string {
  return `${website}/app?bookmarkId=${encodeURIComponent(id)}`
}

interface SummaryFields {
  id: string
  url: unknown
  siteTitle: unknown
  siteDescription: unknown
  type: unknown
  tags: unknown
  siteNotes: unknown
  textNote: unknown
  aiSummary: unknown
  pinned: unknown
  createdAt: unknown
}

function summarise(fields: SummaryFields, website: string): BookmarkSummary {
  const type = text(fields.type) ?? 'website'
  // Text notes keep a blank URL (' ') in Parse.
  const url = text(fields.url)
  const isNote = type === 'textNote'
  const notePlain = isNote ? htmlToPlainText(fields.textNote as string) : ''
  const [firstLine = '', ...rest] = notePlain.split('\n')

  const title = text(fields.siteTitle)
    ?? (isNote ? clip(firstLine.trim(), 120).text || 'Untitled note' : null)
    ?? hostname(url)
    ?? url
    ?? 'Untitled'
  const description = isNote
    ? (rest.join(' ').trim() ? clip(rest.join(' ').replace(/\s+/g, ' ').trim(), 280).text : null)
    : (text(fields.siteDescription) ? clip(text(fields.siteDescription)!, 500).text : null)

  return {
    id: fields.id,
    url,
    title,
    description,
    type,
    tags: Array.isArray(fields.tags) ? fields.tags.filter((tag) => typeof tag === 'string') : [],
    note: isNote ? null : text(fields.siteNotes),
    summary: aiTldr(fields.aiSummary),
    pinned: fields.pinned === true,
    saved_at: isoDate(fields.createdAt),
    web_url: bookmarkWebUrl(website, fields.id),
  }
}

/** A `websites` Parse row (any selection of its columns). */
export function bookmarkSummaryFromRow(row: RowLike, website: string): BookmarkSummary {
  return summarise({
    id: row.id,
    url: row.get('url'),
    siteTitle: row.get('siteTitle'),
    siteDescription: row.get('siteDescription'),
    type: row.get('type'),
    tags: row.get('tags'),
    siteNotes: row.get('siteNotes'),
    textNote: row.get('textNote'),
    aiSummary: row.get('aiSummary'),
    pinned: row.get('pinned'),
    createdAt: row.createdAt ?? row.get('createdAt'),
  }, website)
}

/**
 * A Meilisearch hit. The index folds a bookmark's note into `textNote`
 * (`textNote || siteNotes`), so on a website it *is* the note.
 */
export function bookmarkSummaryFromHit(hit: Record<string, any>, website: string): BookmarkSummary {
  const isNote = hit.type === 'textNote'
  return summarise({
    id: String(hit.objectId ?? hit.id),
    url: hit.url,
    siteTitle: hit.siteTitle,
    siteDescription: hit.siteDescription,
    type: hit.type,
    tags: hit.tags,
    siteNotes: isNote ? null : hit.textNote,
    textNote: isNote ? hit.textNote : null,
    aiSummary: hit.aiSummary,
    pinned: hit.pinned,
    createdAt: hit.createdAt,
  }, website)
}

export interface BookmarkDetailOptions {
  includeContent: boolean
  maxChars: number
}

/** `get_bookmark`'s full record. */
export function bookmarkDetailFromRow(
  row: RowLike,
  boards: Array<{ id: string; name: string }>,
  { includeContent, maxChars }: BookmarkDetailOptions,
  website: string,
) {
  const summary = bookmarkSummaryFromRow(row, website)
  const ai = row.get('aiSummary')
  const points = Array.isArray(ai?.pointsThatBestDescribeThePage)
    ? ai.pointsThatBestDescribeThePage
      .map((point: any) => ({ title: text(point?.title) ?? '', description: text(point?.oneLineDescription) ?? '' }))
      .filter((point: { title: string; description: string }) => point.title || point.description)
    : []

  let content: string | null = null
  let contentTruncated = false
  let contentNote: string | null = null
  if (includeContent) {
    const body = text(row.get('siteBody'))
    if (body) {
      const clipped = clip(body, maxChars)
      content = clipped.text
      contentTruncated = clipped.truncated
    } else {
      contentNote = summary.type === 'textNote'
        ? 'A note has no page text; its text is in text_note.'
        : "WebBites hasn't saved any page text for this bookmark."
    }
  }

  return {
    ...summary,
    text_note: summary.type === 'textNote' ? (htmlToPlainText(row.get('textNote')) || null) : null,
    ai_summary: summary.summary || points.length ? { tldr: summary.summary, points } : null,
    author: text(row.get('siteAuthor')),
    boards,
    content,
    content_truncated: contentTruncated,
    content_note: contentNote,
  }
}

export function boardFromRow(row: RowLike): BoardSummary {
  const mode = row.get('mode')
  const parent = row.get('parent')
  const count = row.get('bookmarkCount')
  return {
    id: row.id,
    name: text(row.get('name')) ?? 'Untitled board',
    description: text(row.get('description')),
    parent_id: typeof parent === 'string' ? parent : parent?.id ?? null,
    bookmark_count: Number.isInteger(count) && count >= 0 ? count : null,
    mode: mode === 'smart' || mode === 'mixed' ? mode : 'manual',
  }
}
