#!/usr/bin/env bun
/**
 * Writes `siteScreenshotUrl` onto search documents indexed before the mapper
 * carried it. The grid lists from Meilisearch, so without it a card whose
 * OGImage is dead falls straight to a gradient.
 *
 *   bun run scripts/backfill-site-screenshot-url.ts --dry
 *   bun run scripts/backfill-site-screenshot-url.ts
 *
 * Walks each index's own ids (primary, then alt if set) so the partial
 * updateDocuments never upserts a skeleton doc. Idempotent.
 */
import Parse from 'parse/node.js'
import { MeiliSearch } from 'meilisearch'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const dry = process.argv.includes('--dry')
const clean = (v?: string) => v?.replace(/["']/g, '').trim()
const targets = [
  [clean(process.env.MEILISEARCH_HOST), clean(process.env.MEILISEARCH_API_KEY)],
  [clean(process.env.MEILISEARCH_HOST_ALT), clean(process.env.MEILISEARCH_API_KEY_ALT) || clean(process.env.MEILISEARCH_API_KEY)],
].filter(([host]) => host)

const PAGE = 1000
for (const [host, apiKey] of targets) {
  const index = new MeiliSearch({ host: host!, apiKey }).index('webbites')
  let offset = 0, updated = 0
  while (true) {
    const { results } = await index.getDocuments({ fields: ['id', 'siteScreenshotUrl'], limit: PAGE, offset })
    if (!results.length) break
    offset += results.length

    const missing = results.filter((d: any) => !d.siteScreenshotUrl).map((d: any) => d.id)
    if (!missing.length) continue
    const rows = await new Parse.Query('websites')
      .containedIn('objectId', missing)
      .exists('siteScreenshot')
      .select('siteScreenshot', 'siteScreenshotUrl')
      .limit(PAGE)
      .find({ useMasterKey: true })
    const docs = rows
      .map(r => ({ id: r.id, siteScreenshotUrl: r.get('siteScreenshotUrl') || r.get('siteScreenshot')?.url?.() || '' }))
      .filter(d => d.siteScreenshotUrl)
    if (docs.length && !dry) await index.updateDocuments(docs, { primaryKey: 'id' })
    updated += docs.length
    console.log(`${host} scanned ${offset}, ${dry ? 'would update' : 'updated'} ${updated}`)
  }
  console.log(`${host}: ${dry ? 'dry run, ' : ''}${updated} documents ${dry ? 'to update' : 'updated'}`)
}
process.exit(0)
