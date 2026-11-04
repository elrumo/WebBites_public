#!/usr/bin/env bun
/**
 * Gives every auto-applying smart/mixed board its `automations` row — the
 * save pipeline no longer reads `boards.smartRules` directly, so boards
 * without one stop filing new bookmarks. Run once when automations ship.
 *
 *   bun run scripts/migrate-smart-boards.ts --dry   # list what would be created
 *   bun run scripts/migrate-smart-boards.ts
 *
 * Idempotent: boards that already own an automation are skipped. Mirrors
 * syncBoardAutomation in server/utils/automations.ts (not imported: the
 * #root alias only resolves inside Nitro).
 */
import Parse from 'parse/node.js'
import { randomBytes } from 'crypto'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const dry = process.argv.includes('--dry')

const boardsQuery = new Parse.Query('boards')
boardsQuery.containedIn('mode', ['smart', 'mixed'])
boardsQuery.notEqualTo('isDeleted', true)
boardsQuery.limit(10000)
const boards = (await boardsQuery.find({ useMasterKey: true }))
  .filter(b => b.get('smartRules')?.autoApply === true && b.get('smartRules')?.topics?.length)

let created = 0
for (const board of boards) {
  const existing = await new Parse.Query('automations')
    .equalTo('board', board.toPointer())
    .first({ useMasterKey: true })
  if (existing) continue

  const ownerId: string = board.get('owner').id
  const rules = board.get('smartRules')
  console.log(`${dry ? '[dry] ' : ''}${board.id} "${board.get('name')}" (${ownerId}) topics=${rules.topics.join(', ')}`)
  if (dry) continue

  const acl = new Parse.ACL()
  acl.setReadAccess(ownerId, true)
  acl.setWriteAccess(ownerId, true)
  const row = new Parse.Object('automations')
  row.set('owner', { __type: 'Pointer', className: '_User', objectId: ownerId })
  row.set('board', board.toPointer())
  row.set('name', board.get('name'))
  row.set('enabled', true)
  row.set('trigger', 'bookmark.added')
  row.set('match', 'all')
  row.set('conditions', [{ field: 'ai_topic', op: 'is', topics: rules.topics, threshold: rules.confidenceThreshold ?? 0.6 }])
  row.set('actions', [{ type: 'add_to_board', boardId: board.id }])
  row.set('secret', `whsec_${randomBytes(24).toString('base64url')}`)
  row.set('runCount', 0)
  row.setACL(acl)
  await row.save(null, { useMasterKey: true })
  created++
}
console.log(`${boards.length} auto-applying smart boards, ${dry ? 'dry run' : `${created} automations created`}`)
process.exit(0)
