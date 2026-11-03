import Parse from 'parse/node.js'
import type { PlanTier } from '../types/plan.types'
import type { McpHandlers, ToolCallOutcome, ToolResult } from './mcpProtocol'
import { MCP_INSTRUCTIONS, SCOPE_READ, SCOPE_WRITE, findTool, toolsForCaller, validateArguments } from './mcpToolCatalogue'
import {
  bookmarkDetailFromRow, bookmarkSummaryFromHit, bookmarkSummaryFromRow, boardFromRow,
} from './mcpFormat'
import { MCP_SERVER_NAME, MCP_SERVER_TITLE, MCP_SERVER_VERSION, mcpResourceMetadataUrl, websiteUrl } from './mcpConfig'
import { searchUserBookmarks, type SearchSort } from './bookmarkSearch'
import { decodeOffsetCursor, encodeOffsetCursor, savedWithin } from './searchFilters'
import { listUserTags } from './tagList'
import {
  addBookmarksToBoardForUser, countBoardBookmarks, createBoard, getBoardBookmarkEntries,
  getBookmarkBoardMemberships, getOwnedBoardOrThrow, getUserBoards, initParseForBoards,
} from './boardUtils'
import { findVisibleBookmark, trashBookmarkForUser, updateBookmarkFields } from './bookmarkEdits'
import { normaliseTags } from './bookmarkEditRules'
import { createTextNote } from './textNotes'
import { plainTextToNoteHtml } from './textNoteHtml'
import { meterApiCall } from './publicApi'
import { recordApiMetric } from './apiMetrics'
import { captureException } from './sentry.js'
import { SaveBookmark } from '../routes/v1/content/saveBookmark'
import { enqueueEnrichment } from './jobs/processJob.js'
import { isUrlAnImage } from './serverUtils.js'

/**
 * The cloud MCP server's tools, for one authenticated caller. Each handler is
 * a thin layer over the helpers the routes already use — search, boards,
 * notes, edits, trash — so an assistant sees exactly what the apps see, minus
 * the trash and hidden bookmarks (the developer API's rule: an assistant is a
 * wider audience than the user's own screen).
 *
 * Every tools/call is checked against the caller's scopes, its arguments
 * against the catalogue, and is then metered against the developer-API
 * allowance. Anything the model can fix — a bad argument, an unknown id, a
 * spent allowance — comes back as a tool error it can read, not a protocol
 * error.
 */

export interface McpCaller {
  userId: string
  user: Parse.Object
  tier: PlanTier
  scopes: Set<string>
  /** The per-minute bucket and the usage field this caller's calls count against. */
  rateBucket: string
  usageField: string
}

/** A failure the model should read and can act on. */
class ToolError extends Error {}

type ToolHandler = (caller: McpCaller, args: Record<string, any>) => Promise<Record<string, unknown>>

const SEARCH_ATTRIBUTES = [
  'objectId', 'url', 'siteTitle', 'siteDescription', 'tags', 'textNote', 'type', 'createdAt', 'aiSummary', 'pinned',
]

const BOARD_ENTRY_FIELDS = ['siteNotes', 'pinned', 'createdAt', 'aiSummary']

const NOT_FOUND_HINT = 'Use search_bookmarks to find bookmark ids.'

/** h3's createError, as thrown by the shared helpers. */
function httpStatus(error: unknown): number | undefined {
  const status = (error as any)?.statusCode
  return typeof status === 'number' ? status : undefined
}

async function ownedBoard(user: Parse.Object, boardId: string): Promise<Parse.Object> {
  try {
    return await getOwnedBoardOrThrow(user as Parse.User, boardId)
  } catch (error) {
    if (httpStatus(error) === 404) throw new ToolError(`There is no board with id ${boardId}. Use list_boards to see board ids.`)
    throw error
  }
}

function cursorOffset(cursor: string | undefined): number {
  try {
    return decodeOffsetCursor(cursor)
  } catch {
    throw new ToolError('That cursor is not valid. Repeat the request without a cursor to start from the first page.')
  }
}

/** An existing, visible bookmark of this URL, so saving twice doesn't duplicate it. */
async function findBookmarkByUrl(userId: string, url: string): Promise<Parse.Object | null> {
  const variants = new Set([url, url.endsWith('/') ? url.slice(0, -1) : `${url}/`])
  const query = new Parse.Query('websites')
  query.equalTo('user', { __type: 'Pointer', className: '_User', objectId: userId } as any)
  query.containedIn('url', [...variants])
  query.notEqualTo('isDeleted', true)
  query.notContainedIn('hiddenFrom', ['library', 'everywhere'])
  query.descending('createdAt')
  return (await query.first({ useMasterKey: true })) ?? null
}

const QUOTA_MESSAGE = 'The bookmark limit on this plan has been reached, so nothing was saved. '
  + 'The user can free up space or move to a larger plan.'

const handlers: Record<string, ToolHandler> = {
  async search_bookmarks(caller, args) {
    const limit: number = args.limit ?? 20
    const offset = cursorOffset(args.cursor)
    const dated = Boolean(args.saved_after || args.saved_before)
    // Dates are checked on the hits (see savedWithin), so a dated search reads
    // further ahead to fill a page.
    const fetchLimit = dated ? Math.min(limit * 4, 200) : limit
    const { hits, estimatedTotalHits } = await searchUserBookmarks(caller.userId, {
      query: args.query,
      tags: args.tags,
      type: args.type,
      sort: args.sort as SearchSort | undefined,
      limit: fetchLimit,
      offset,
      attributesToRetrieve: SEARCH_ATTRIBUTES,
    })

    let page = hits
    let consumed = hits.length
    let more = offset + limit < estimatedTotalHits
    if (dated) {
      page = []
      consumed = 0
      for (const hit of hits) {
        consumed++
        if (savedWithin(hit.createdAt, args.saved_after, args.saved_before)) page.push(hit)
        if (page.length === limit) break
      }
      more = consumed < hits.length || hits.length === fetchLimit
    }

    const website = websiteUrl()
    return {
      bookmarks: page.map((hit) => bookmarkSummaryFromHit(hit, website)),
      next_cursor: more ? encodeOffsetCursor(offset + (dated ? consumed : limit)) : null,
    }
  },

  async get_bookmark(caller, args) {
    const row = await findVisibleBookmark(caller.userId, args.id)
    if (!row) throw new ToolError(`There is no bookmark with id ${args.id}. ${NOT_FOUND_HINT}`)
    const memberships = await getBookmarkBoardMemberships(row.id, caller.userId)
    const boards = memberships
      .map((membership) => membership.get('board'))
      .filter((board) => board && board.get('isDeleted') !== true)
      .map((board) => ({ id: board.id as string, name: (board.get('name') as string) || 'Untitled board' }))
    return {
      bookmark: bookmarkDetailFromRow(row, boards, {
        includeContent: args.include_content === true,
        maxChars: args.max_chars ?? 8000,
      }, websiteUrl()),
    }
  },

  async list_boards(caller) {
    const boards = await getUserBoards(caller.user as Parse.User, 500)
    // Folders only group boards; an assistant files bookmarks into boards.
    return { boards: boards.filter((board) => board.get('kind') !== 'folder').map(boardFromRow) }
  },

  async list_board_bookmarks(caller, args) {
    const board = await ownedBoard(caller.user, args.board_id)
    const limit: number = args.limit ?? 20
    const offset = cursorOffset(args.cursor)
    const [entries, total] = await Promise.all([
      getBoardBookmarkEntries(board.id, limit, offset, BOARD_ENTRY_FIELDS),
      countBoardBookmarks(board.id),
    ])
    const website = websiteUrl()
    const bookmarks = entries
      .map((entry) => entry.get('website'))
      // The board helper keeps bookmarks hidden from the library (they stay on
      // their boards in the app); an assistant doesn't get those.
      .filter((row) => row && row.get('hiddenFrom') !== 'library')
      .map((row) => bookmarkSummaryFromRow(row, website))
    return {
      board: { id: board.id, name: (board.get('name') as string) || 'Untitled board' },
      bookmarks,
      next_cursor: offset + limit < total ? encodeOffsetCursor(offset + limit) : null,
    }
  },

  async list_tags(caller, args) {
    const tags = await listUserTags(caller.userId, { q: args.query?.trim() ?? '' })
    return { tags: tags.slice(0, args.limit ?? 50) }
  },

  async save_bookmark(caller, args) {
    let url: URL
    try {
      url = new URL(String(args.url).trim())
    } catch {
      throw new ToolError('url must be an absolute http(s) URL.')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ToolError('url must be an http(s) URL.')
    const href = url.toString()

    // Checked before saving, so a wrong board id doesn't leave a bookmark behind.
    const board = args.board_id ? await ownedBoard(caller.user, args.board_id) : null
    const website = websiteUrl()

    const existing = await findBookmarkByUrl(caller.userId, href)
    if (existing) {
      if (board) await addBookmarksToBoardForUser(board, [existing.id], caller.userId, { excludeHidden: true })
      return {
        status: 'already_saved',
        bookmark: bookmarkSummaryFromRow(existing, website),
        message: board ? 'This page was already saved; it is now on the board too.' : 'This page was already saved.',
      }
    }

    const result: any = await new SaveBookmark().saveBookmark({
      userId: caller.userId,
      url: href,
      savedFrom: 'mcp',
      tags: args.tags ? normaliseTags(args.tags) : undefined,
      siteNotes: args.note ? String(args.note).trim() : null,
    } as any)

    if (!result || result.status === 'error') {
      const message = String(result?.error || 'WebBites could not save that page.')
      throw new ToolError(/limit/i.test(message) ? QUOTA_MESSAGE : message)
    }
    const saved = result.savedSite ?? result.bookmark ?? result
    const isRow = typeof saved?.get === 'function' && typeof saved?.id === 'string'
    // Screenshot, summary, tags and boards: the same pipeline the apps get.
    // Image bookmarks take their own path inside saveBookmark and need none of it.
    if (isRow && !isUrlAnImage(href)) {
      void enqueueEnrichment(saved.id, { url: href, userId: caller.userId, fromCache: true })
    }
    if (isRow && board) await addBookmarksToBoardForUser(board, [saved.id], caller.userId)

    return {
      status: 'saved',
      bookmark: isRow ? bookmarkSummaryFromRow(saved, website) : null,
      message: 'Saved. WebBites is fetching the title, image and summary in the background, so they appear shortly.',
    }
  },

  async save_note(caller, args) {
    let row: Parse.Object
    try {
      row = await createTextNote({
        userId: caller.userId,
        textNote: plainTextToNoteHtml(String(args.text), args.title),
        tags: normaliseTags(args.tags),
        savedFrom: 'mcp',
      })
    } catch (error) {
      if (httpStatus(error) === 402) throw new ToolError(QUOTA_MESSAGE)
      throw error
    }
    return { status: 'saved', bookmark: bookmarkSummaryFromRow(row, websiteUrl()), message: 'Note saved.' }
  },

  async update_bookmark(caller, args) {
    const outcome = await updateBookmarkFields(caller.userId, args.id, {
      title: args.title ?? undefined,
      note: args.note ?? undefined,
      tags: args.tags ?? undefined,
      addTags: args.add_tags ?? undefined,
      removeTags: args.remove_tags ?? undefined,
      pinned: typeof args.pinned === 'boolean' ? args.pinned : undefined,
    })
    if (!outcome) throw new ToolError(`There is no bookmark with id ${args.id}. ${NOT_FOUND_HINT}`)
    if (!outcome.changed) {
      throw new ToolError('Nothing to change: give at least one of title, note, tags, add_tags, remove_tags or pinned.')
    }
    return { status: 'updated', bookmark: bookmarkSummaryFromRow(outcome.row, websiteUrl()) }
  },

  async create_board(caller, args) {
    try {
      const board = await createBoard(caller.user as Parse.User, caller.userId, {
        name: String(args.name),
        description: args.description ?? null,
        parentId: args.parent_id ?? null,
      })
      return { status: 'created', board: boardFromRow(board) }
    } catch (error) {
      const status = httpStatus(error)
      if (status === 404) throw new ToolError(`There is no board with id ${args.parent_id}. Use list_boards to see board ids.`)
      if (status === 400) throw new ToolError((error as any).statusMessage || 'That board could not be created.')
      throw error
    }
  },

  async add_to_board(caller, args) {
    const board = await ownedBoard(caller.user, args.board_id)
    const { results } = await addBookmarksToBoardForUser(board, args.bookmark_ids, caller.userId, { excludeHidden: true })
    return {
      status: 'updated',
      board_id: board.id,
      added: results.filter((r) => r.status === 'created' || r.status === 'reactivated').length,
      already_present: results.filter((r) => r.status === 'already_exists' || r.status === 'removed_by_user').length,
      not_found: results.filter((r) => r.status === 'not_found' || r.status === 'failed').map((r) => r.websiteId),
    }
  },

  async delete_bookmark(caller, args) {
    const trashed = await trashBookmarkForUser(caller.userId, args.id)
    if (!trashed) throw new ToolError(`There is no bookmark with id ${args.id}. ${NOT_FOUND_HINT}`)
    return { status: 'trashed', id: trashed.id, restorable_until: trashed.restorableUntil }
  },
}

function toolResult(structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured, isError: false }
}

function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** The 403 a read-only connection gets for a write tool, so the client can ask for more (step-up). */
function insufficientScope(toolName: string): ToolCallOutcome {
  return {
    kind: 'forbidden',
    message: `${toolName} changes the library, and this connection was approved for reading only.`,
    headers: {
      'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${SCOPE_READ} ${SCOPE_WRITE}", `
        + `resource_metadata="${mcpResourceMetadataUrl()}", `
        + `error_description="This connection can only read the library"`,
    },
  }
}

export function createMcpHandlers(caller: McpCaller): McpHandlers {
  const canWrite = caller.scopes.has(SCOPE_WRITE)
  return {
    serverInfo: {
      name: MCP_SERVER_NAME,
      title: MCP_SERVER_TITLE,
      version: MCP_SERVER_VERSION,
      websiteUrl: websiteUrl(),
      icons: [{ src: `${websiteUrl()}/icon512x512.png`, mimeType: 'image/png', sizes: ['512x512'] }],
    },
    instructions: MCP_INSTRUCTIONS,
    listTools: () => toolsForCaller(canWrite),

    async callTool(name, args) {
      const tool = findTool(name)
      const handler = handlers[name]
      if (!tool || !handler) return { kind: 'unknown_tool' }
      if (tool.write && !canWrite) return insufficientScope(name)

      const problem = validateArguments(tool.inputSchema, args)
      if (problem) return { kind: 'result', result: toolError(problem) }

      const meter = await meterApiCall({
        userId: caller.userId, tier: caller.tier, rateBucket: caller.rateBucket, usageField: caller.usageField,
      })
      if (meter.ok === false) {
        return {
          kind: 'result',
          result: toolError(meter.reason === 'rate'
            ? `Too many WebBites requests this minute. Try again in ${meter.retryAfter ?? 60} seconds.`
            : `${meter.message}.`),
        }
      }

      const started = performance.now()
      let status = 200
      try {
        initParseForBoards()
        return { kind: 'result', result: toolResult(await handler(caller, args)) }
      } catch (error: any) {
        if (error instanceof ToolError) {
          status = 400
          return { kind: 'result', result: toolError(error.message) }
        }
        status = 500
        console.error(`[MCP] ${name} failed:`, error)
        captureException(error, { tags: { mcpTool: name } })
        return { kind: 'result', result: toolError('WebBites hit an error running this tool. Try again in a moment.') }
      } finally {
        recordApiMetric(`MCP ${name}`, status, performance.now() - started, caller.userId).catch(() => {})
      }
    },
  }
}
