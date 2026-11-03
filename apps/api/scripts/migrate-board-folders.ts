#!/usr/bin/env bun
/**
 * Only folders may contain boards now. Wraps every board that has sub-boards
 * in a folder of the same name (see server/utils/boardFolders.ts). Run once at
 * deploy, after the API that knows about folders is live.
 *
 *   bun --env-file=.env run scripts/migrate-board-folders.ts --dry   # list what would change
 *   bun --env-file=.env run scripts/migrate-board-folders.ts
 *
 * Idempotent: once no board has children there is nothing left to wrap.
 */
import Parse from 'parse/node.js'
import { planFolderWraps } from '../server/utils/boardFolders'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const dry = process.argv.includes('--dry')
const opts = { useMasterKey: true }

const all: Parse.Object[] = []
for (let skip = 0; ; skip += 1000) {
  const page = await new Parse.Query('boards').notEqualTo('isDeleted', true).limit(1000).skip(skip).ascending('createdAt').find(opts)
  all.push(...page)
  if (page.length < 1000) break
}
const byId = new Map(all.map(b => [b.id, b]))
// Folders can't have been wrapped already; only boards can be in need of it.
const boards = all.filter(b => b.get('kind') !== 'folder')

const { wraps, rows } = planFolderWraps(boards.map(b => ({
  id: b.id,
  parentId: b.get('parent')?.id ?? null,
  path: b.get('path') || [],
  sortIndex: b.get('sortIndex') ?? 0,
})))
if (!wraps.length) { console.log('Nothing to migrate.'); process.exit(0) }

// Rows that sit under a wrapped board but are not boards (folders) are moved with it.
const real = new Map<string, string>()
for (const wrap of wraps) {
  const board = byId.get(wrap.boardId)!
  console.log(`${dry ? '[dry] ' : ''}wrap "${board.get('name')}" (${wrap.boardId}) in a folder`)
  if (dry) continue
  const folder = new Parse.Object('boards')
  folder.set('name', board.get('name'))
  folder.set('kind', 'folder')
  folder.set('owner', board.get('owner'))
  folder.set('bookmarkCount', 0)
  folder.set('visibility', 'private')
  folder.set('isDeleted', false)
  folder.set('mode', 'manual')
  folder.set('publicSlug', crypto.randomUUID())
  if (wrap.parentId) folder.set('parent', { __type: 'Pointer', className: 'boards', objectId: wrap.parentId.startsWith('new-folder-') ? real.get(wrap.parentId)! : wrap.parentId })
  folder.set('path', wrap.path.map(id => real.get(id) ?? id))
  folder.set('sortIndex', wrap.sortIndex)
  if (board.get('icon')) folder.set('icon', board.get('icon'))
  if (board.get('color')) folder.set('color', board.get('color'))
  if (board.getACL()) folder.setACL(board.getACL())
  await folder.save(null, opts)
  real.set(wrap.folderId, folder.id)
}
if (dry) process.exit(0)

const fix = (id: string | null) => (id ? real.get(id) ?? id : null)
const changed: Parse.Object[] = []
for (const row of rows.values()) {
  const board = byId.get(row.id)!
  const parentId = fix(row.parentId)
  const path = row.path.map(id => fix(id)!)
  const before = JSON.stringify([board.get('parent')?.id ?? null, board.get('path') || [], board.get('sortIndex') ?? 0])
  if (before === JSON.stringify([parentId, path, row.sortIndex])) continue
  if (parentId) board.set('parent', { __type: 'Pointer', className: 'boards', objectId: parentId })
  else board.unset('parent')
  board.set('path', path)
  board.set('sortIndex', row.sortIndex)
  changed.push(board)
}
for (let i = 0; i < changed.length; i += 100) await Parse.Object.saveAll(changed.slice(i, i + 100), opts)
console.log(`Created ${wraps.length} folders, updated ${changed.length} boards.`)
