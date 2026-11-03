import contract from '../../docs/mcp-tools.json'
import type { McpTool } from './mcpProtocol'

/**
 * The MCP tools: names, descriptions, input schemas and annotations come from
 * `docs/mcp-tools.json`, the contract the Mac app's local server implements
 * too, so the two can't drift apart without a test noticing. This module adds
 * the output schemas and the scope rules. Pure (`npm run test:mcpToolCatalogue`).
 */

export const SCOPE_READ = 'bookmarks:read'
export const SCOPE_WRITE = 'bookmarks:write'
export const ALL_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const

export interface CatalogueTool extends McpTool {
  /** Needs `bookmarks:write`; hidden from callers without it. */
  write: boolean
}

const nullable = (type: string) => ({ type: [type, 'null'] })

const BOOKMARK_SUMMARY_PROPERTIES = {
  id: { type: 'string' },
  url: nullable('string'),
  title: { type: 'string' },
  description: nullable('string'),
  type: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  note: nullable('string'),
  summary: nullable('string'),
  pinned: { type: 'boolean' },
  saved_at: nullable('string'),
  web_url: { type: 'string' },
}

const BOOKMARK_SUMMARY = {
  type: 'object',
  properties: BOOKMARK_SUMMARY_PROPERTIES,
  required: Object.keys(BOOKMARK_SUMMARY_PROPERTIES),
}

const BOOKMARK_PROPERTIES = {
  ...BOOKMARK_SUMMARY_PROPERTIES,
  text_note: nullable('string'),
  ai_summary: nullable('object'),
  author: nullable('string'),
  boards: {
    type: 'array',
    items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'] },
  },
  content: nullable('string'),
  content_truncated: { type: 'boolean' },
  content_note: nullable('string'),
}

const BOOKMARK = { type: 'object', properties: BOOKMARK_PROPERTIES, required: Object.keys(BOOKMARK_PROPERTIES) }

const BOARD_PROPERTIES = {
  id: { type: 'string' },
  name: { type: 'string' },
  description: nullable('string'),
  parent_id: nullable('string'),
  bookmark_count: nullable('integer'),
  mode: { type: 'string', enum: ['manual', 'smart', 'mixed'] },
}

const BOARD = { type: 'object', properties: BOARD_PROPERTIES, required: Object.keys(BOARD_PROPERTIES) }

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required })

const OUTPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
  search_bookmarks: object({ bookmarks: { type: 'array', items: BOOKMARK_SUMMARY }, next_cursor: nullable('string') }),
  get_bookmark: object({ bookmark: BOOKMARK }),
  list_boards: object({ boards: { type: 'array', items: BOARD } }),
  list_board_bookmarks: object({
    board: object({ id: { type: 'string' }, name: { type: 'string' } }),
    bookmarks: { type: 'array', items: BOOKMARK_SUMMARY },
    next_cursor: nullable('string'),
  }),
  list_tags: object({
    tags: { type: 'array', items: object({ name: { type: 'string' }, count: { type: 'integer' } }) },
  }),
  save_bookmark: object({
    status: { type: 'string', enum: ['saved', 'already_saved', 'queued'] },
    bookmark: { anyOf: [BOOKMARK_SUMMARY, { type: 'null' }] },
    message: { type: 'string' },
  }),
  save_note: object({
    status: { type: 'string', enum: ['saved', 'queued'] },
    bookmark: { anyOf: [BOOKMARK_SUMMARY, { type: 'null' }] },
    message: { type: 'string' },
  }),
  update_bookmark: object({
    status: { type: 'string', enum: ['updated', 'queued'] },
    bookmark: { anyOf: [BOOKMARK_SUMMARY, { type: 'null' }] },
  }),
  create_board: object({
    status: { type: 'string', enum: ['created', 'queued'] },
    board: { anyOf: [BOARD, { type: 'null' }] },
  }),
  add_to_board: object({
    status: { type: 'string', enum: ['updated', 'queued'] },
    board_id: { type: 'string' },
    added: { type: 'integer' },
    already_present: { type: 'integer' },
    not_found: { type: 'array', items: { type: 'string' } },
  }),
  delete_bookmark: object({
    status: { type: 'string', enum: ['trashed', 'queued'] },
    id: { type: 'string' },
    restorable_until: nullable('string'),
  }),
}

export const MCP_TOOLS: CatalogueTool[] = contract.tools.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema as Record<string, unknown>,
  outputSchema: OUTPUT_SCHEMAS[tool.name],
  annotations: { title: tool.title, ...tool.annotations },
  write: tool.write,
}))

export const MCP_INSTRUCTIONS: string = contract.instructions

export function findTool(name: string): CatalogueTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name)
}

/** The tools a caller may see, in catalogue order, without the internal `write` flag. */
export function toolsForCaller(canWrite: boolean): McpTool[] {
  return MCP_TOOLS
    .filter((tool) => canWrite || !tool.write)
    .map(({ write: _write, ...tool }) => tool)
}

// ─── Argument validation ─────────────────────────────────────────────────────

type Schema = Record<string, any>

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value: unknown, type: string | string[] | undefined): boolean {
  if (!type) return true
  const types = Array.isArray(type) ? type : [type]
  const actual = typeOf(value)
  return types.some((t) => t === actual || (t === 'number' && actual === 'integer'))
}

function checkValue(path: string, value: unknown, schema: Schema): string | null {
  if (!matchesType(value, schema.type)) {
    return `${path} must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of: ${schema.enum.join(', ')}`

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return schema.minLength === 1 ? `${path} must not be empty` : `${path} must be at least ${schema.minLength} characters`
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} must be at most ${schema.maxLength} characters`
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) return `${path} must be an ISO 8601 date-time`
    if (schema.format === 'uri') {
      try { new URL(value) } catch { return `${path} must be an absolute URL` }
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} item(s)`
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} takes at most ${schema.maxItems} items`
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const problem = checkValue(`${path}[${i}]`, value[i], schema.items)
        if (problem) return problem
      }
    }
  }
  if (typeOf(value) === 'object' && schema.properties) return checkObject(path, value as Record<string, unknown>, schema)
  return null
}

function checkObject(path: string, value: Record<string, unknown>, schema: Schema): string | null {
  const properties: Record<string, Schema> = schema.properties ?? {}
  for (const name of schema.required ?? []) {
    if (value[name] === undefined || value[name] === null) return `Missing required argument '${path ? `${path}.` : ''}${name}'`
  }
  for (const [name, item] of Object.entries(value)) {
    const label = path ? `${path}.${name}` : name
    if (!(name in properties)) {
      if (schema.additionalProperties === false) return `Unknown argument '${label}'. Accepted: ${Object.keys(properties).join(', ') || 'none'}`
      continue
    }
    if (item === undefined || item === null) continue // treated as absent
    const problem = checkValue(label, item, properties[name])
    if (problem) return problem
  }
  return null
}

/**
 * Checks tool arguments against the subset of JSON Schema the catalogue uses.
 * Returns a sentence a model can act on, or null when they are valid. Nulls
 * count as absent: models often send `"tags": null` for "no tags".
 */
export function validateArguments(schema: Schema, args: Record<string, unknown>): string | null {
  return checkObject('', args, schema)
}
