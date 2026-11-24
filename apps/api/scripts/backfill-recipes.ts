#!/usr/bin/env bun
/**
 * Queues recipe extraction for bookmarks saved before the recipe type existed
 * (see `server/routes/v1/content/extractRecipe.post.ts`): the same stage a
 * fresh save goes through, on the low-priority import queue.
 *
 *   bun run scripts/backfill-recipes.ts              # dry run: counts and lists, queues nothing
 *   bun run scripts/backfill-recipes.ts --apply
 *   bun run scripts/backfill-recipes.ts --apply --limit=500 --delay=500
 *
 * Candidates are website rows with page text that names an ingredient list and
 * no recipe yet. The stage itself decides (JSON-LD, then Jev and the text model),
 * so a candidate that is no recipe is left as it was. Re-running is safe: a row
 * that already has its recipe is skipped. One the stage turned down is not
 * marked, so a re-run asks about it again (a JSON-LD read, sometimes a Jev call).
 *
 * Rows are walked in `createdAt` order, 30 days at a time (an unwindowed text
 * match on `websites` scans the whole class). `--delay` is the pause in ms
 * between batches of 20 messages, so QStash and the model are not flooded.
 */
import Parse from 'parse/node.js'
import { sendToQstash, getPartitionedQueue } from '../server/utils/serverUtils'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const arg = (name: string, fallback: number) => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : fallback
}
const apply = process.argv.includes('--apply')
const limit = arg('limit', Infinity)
const delay = arg('delay', 1000)
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const PAGE = 200
const BATCH = 20

const base = () =>
  new Parse.Query('websites')
    .equalTo('type', 'website')
    .notEqualTo('isDeleted', true)
    .doesNotExist('recipe')
    .notEqualTo('contentWalled', true)
    // The pre-filter extractRecipe applies, in English: the page names its ingredients.
    .matches('siteBody', /ingredients/i)
    .select('url', 'user')

const first = await new Parse.Query('websites').ascending('createdAt').select('createdAt').first({ useMasterKey: true })
if (!first) {
  console.log('no bookmarks')
  process.exit(0)
}

const message = (id: string, userId: string, url: string) => ({
  body: {
    type: 'page-content-requests',
    subType: 'extractRecipe',
    data: { savedSiteId: id, websiteData: { url, userId, savedSiteId: id, fromCache: true, importing: true } },
  },
})

let from = first.createdAt as Date
const now = Date.now()
let found = 0, queued = 0

windows: while (from.getTime() <= now) {
  const to = new Date(from.getTime() + WINDOW_MS)
  let lastId: string | undefined
  while (true) {
    const query = base().greaterThanOrEqualTo('createdAt', from).lessThan('createdAt', to).ascending('objectId').limit(PAGE)
    if (lastId) query.greaterThan('objectId', lastId)
    const rows = await query.find({ useMasterKey: true })
    if (!rows.length) break
    lastId = rows[rows.length - 1].id

    const batch = rows.slice(0, limit - found).filter(r => r.get('user')?.id)
    found += batch.length
    for (let i = 0; i < batch.length; i += BATCH) {
      const slice = batch.slice(i, i + BATCH)
      if (!apply) {
        slice.forEach(r => console.log(`would queue ${r.id}  ${r.get('url')}`))
        continue
      }
      await sendToQstash(slice.map(r => message(r.id, r.get('user').id, r.get('url'))), { isBatch: true, queueName: getPartitionedQueue('getBookmarkContent-import') })
      queued += slice.length
      console.log(`queued ${queued}`)
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    }
    if (found >= limit) break windows
  }
  from = to
}

console.log(apply ? `queued ${queued} of ${found} candidates` : `${found} candidates (dry run, nothing queued; add --apply)`)
process.exit(0)
