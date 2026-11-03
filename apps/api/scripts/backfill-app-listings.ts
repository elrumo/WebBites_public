#!/usr/bin/env bun
/**
 * Gives every already-saved App Store / Google Play bookmark its app listing,
 * the same way a fresh save gets one (see `server/utils/appListing.ts`).
 *
 *   bun run scripts/backfill-app-listings.ts --dry
 *   bun run scripts/backfill-app-listings.ts
 *   bun run scripts/backfill-app-listings.ts --delay=5000 --limit=200
 *
 * Idempotent: only rows with no `appListing` — or one saved before the card
 * summary (`appCard`) existed — are touched, so re-running picks up what failed
 * (a delisted app, a store that was down) and nothing else. A row that already
 * has its listing only gets the summary derived from it, with no store request.
 *
 * One listing is shared by every row that saves the same app, so the stores are
 * asked once per app, not once per bookmark. `--delay` (default 3000 ms) is the
 * pause after each App Store app that was not already stored — Apple's lookup
 * API answers roughly 20 requests a minute per IP before it starts refusing.
 * That is the floor on speed, so Google Play apps (4 at a time, no pause) and
 * the rows that only need their card derived run in parallel with that queue.
 *
 * Rows are walked in `createdAt` order, 30 days at a time, so each query stays
 * small instead of scanning the whole class for a `url` prefix. Saving a row
 * reindexes it (the new title and developer reach search) but does not touch
 * `saveStage`, so no `bookmark.saved` webhook fires again.
 */
import Parse from 'parse/node.js'
import { applyAppListing, appCardOf, parseAppUrl, listingKey } from '../server/utils/appListing'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const arg = (name: string, fallback: number) => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : fallback
}
const dry = process.argv.includes('--dry')
const delay = arg('delay', 3000)
const limit = arg('limit', Infinity)
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const PAGE = 500
const PLAY_CONCURRENCY = 4

const PREFIXES = ['apps.apple.com', 'itunes.apple.com', 'play.google.com'].flatMap(host => [`https://${host}/`, `http://${host}/`, `https://www.${host}/`])
const urlMatches = Parse.Query.or(...PREFIXES.map(prefix => new Parse.Query('websites').startsWith('url', prefix)))

const base = () =>
  Parse.Query.and(
    urlMatches,
    Parse.Query.or(new Parse.Query('websites').doesNotExist('appListing'), new Parse.Query('websites').doesNotExist('appCard')),
    new Parse.Query('websites').notEqualTo('isDeleted', true),
    // A game or film saved from the App Store / TMDB has its own media view.
    new Parse.Query('websites').notContainedIn('type', ['game', 'movie'])
  )

const first = await new Parse.Query('websites').ascending('createdAt').select('createdAt').first({ useMasterKey: true })
if (!first) {
  console.log('no bookmarks')
  process.exit(0)
}

// Apps already stored by an earlier run (or by live saves): no store request, so no pause.
const cachedKeys = new Set<string>()
await new Parse.Query('AppListings').select('key').each(r => { cachedKeys.add(r.get('key')) }, { useMasterKey: true })

const pool = async <T>(items: T[], n: number, fn: (item: T) => Promise<void>) => {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

let from = first.createdAt as Date
const now = Date.now()
let found = 0, attached = 0, failed = 0, skipped = 0

type Row = Awaited<ReturnType<ReturnType<typeof base>['find']>>[number]
type Job = { key: string; store: string; url: string; rows: Row[] }

/** Saved before the card summary existed: derive it, no store request. */
const addCard = async (row: Row) => {
  row.set('appCard', appCardOf(row.get('appListing')))
  await row.save(null, { useMasterKey: true })
  attached++
  console.log(`card ${listingKey(parseAppUrl(row.get('url'))!)}  ${row.id}`)
}

/** All rows of one app, in order: the first fetches and stores the listing, the rest read it back. */
const attachApp = async (job: Job) => {
  for (const row of job.rows) {
    try {
      if (await applyAppListing(row, job.url)) {
        await row.save(null, { useMasterKey: true })
        attached++
        console.log(`attached ${job.key}  ${row.id}  "${row.get('siteTitle')}"`)
      } else {
        failed++
        console.log(`no listing for ${job.key}  ${row.id}`)
      }
    } catch (error: any) {
      failed++
      console.warn(`failed ${job.key}  ${row.id}: ${error?.message || error}`)
    }
  }
  // Only a real store request needs the pause.
  const fetched = !cachedKeys.has(job.key)
  cachedKeys.add(job.key)
  if (fetched && job.store === 'appstore' && delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
}

windows: while (from.getTime() <= now) {
  const to = new Date(from.getTime() + WINDOW_MS)
  let lastId: string | undefined
  while (true) {
    const query = base().greaterThanOrEqualTo('createdAt', from).lessThan('createdAt', to).ascending('objectId').limit(PAGE)
    if (lastId) query.greaterThan('objectId', lastId)
    const rows = await query.find({ useMasterKey: true })
    if (!rows.length) break
    lastId = rows[rows.length - 1].id

    const batch = rows.slice(0, limit - found)
    found += batch.length
    const cards: Row[] = []
    const jobs = new Map<string, Job>()
    for (const row of batch) {
      const url = row.get('url') as string
      const parsed = parseAppUrl(url)
      if (!parsed) { skipped++; continue }
      const key = listingKey(parsed)
      if (dry) { console.log(`would attach ${key}  ${row.id}`); continue }
      if (row.get('appListing')) cards.push(row)
      else if (jobs.has(key)) jobs.get(key)!.rows.push(row)
      else jobs.set(key, { key, store: parsed.store, url, rows: [row] })
    }

    // Apple's lookup API is rate-limited per IP, so App Store apps go one at a
    // time with `--delay`; Google Play and the card-only rows run beside them.
    const all = [...jobs.values()]
    await Promise.all([
      pool(cards, 10, addCard),
      pool(all.filter(j => j.store === 'appstore'), 1, attachApp),
      pool(all.filter(j => j.store !== 'appstore'), PLAY_CONCURRENCY, attachApp)
    ])
    if (found >= limit) break windows
    if (rows.length < PAGE) break
  }
  from = to
}

console.log(`${dry ? 'dry run: ' : ''}${found} app bookmarks found, ${attached} attached, ${failed} without a listing, ${skipped} not app pages`)
process.exit(0)
