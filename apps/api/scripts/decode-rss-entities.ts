#!/usr/bin/env bun
/**
 * Decodes HTML character references in RSS rows written before the parser did
 * it at ingest (`plain()` in server/utils/rssParser.ts).
 *
 *   bun run scripts/decode-rss-entities.ts            # dry run, prints samples
 *   bun run scripts/decode-rss-entities.ts --apply    # writes to Parse
 *
 * Run once, after the parser change is deployed. It is safe to re-run, and
 * safe to run while polls are going. Decoding twice would turn `&amp;lt;` into
 * `<`, but every row the new code writes carries `entitiesDecoded`, and so does
 * every row this script changes. Marked rows are skipped. A row whose text is
 * already clean comes out unchanged, so it is never saved.
 *
 * - rssItems: `title` and `author` go through `plain()`. `rssContentText` is
 *   rebuilt from the stored `rssContentHtml`, which is left as it is. That
 *   rebuild is idempotent, so the marker does not matter for it.
 * - rssFeeds: `title` and `feedDescription`. Discovery candidates and
 *   subscription titles are both read from these at request time.
 *
 * `dedupKey` is not touched. It hashes the raw guid, which the parser never
 * decodes. A subscription's `customTitle` is the user's own text and is not
 * touched either.
 */
import Parse from 'parse/node.js'
import { plain, RSS_CONTENT_TEXT_LIMIT } from '../server/utils/rssParser'
import { htmlToText } from '../server/utils/contentExtraction'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const apply = process.argv.includes('--apply')

type Fix = (row: Parse.Object) => Record<string, string | null>

const CLASSES: Record<string, { fields: string[]; fix: Fix }> = {
  rssItems: {
    fields: ['title', 'author', 'rssContentHtml', 'rssContentText'],
    fix: (row) => ({
      title: plain(row.get('title') || '') || null,
      author: plain(row.get('author') || '') || null,
      rssContentText: htmlToText(row.get('rssContentHtml') || '', RSS_CONTENT_TEXT_LIMIT),
    }),
  },
  rssFeeds: {
    fields: ['title', 'feedDescription'],
    fix: (row) => ({
      title: plain(row.get('title') || '') || null,
      feedDescription: plain(row.get('feedDescription') || '') || null,
    }),
  },
}

for (const [className, { fields, fix }] of Object.entries(CLASSES)) {
  let after = ''
  let scanned = 0
  let changed = 0

  while (true) {
    const query = new Parse.Query(className)
    query.notEqualTo('entitiesDecoded', true)
    if (after) query.greaterThan('objectId', after)
    query.ascending('objectId')
    query.select(...fields)
    query.limit(500)
    const rows = await query.find({ useMasterKey: true })
    if (!rows.length) break
    after = rows[rows.length - 1].id
    scanned += rows.length

    const dirty: Parse.Object[] = []
    for (const row of rows) {
      const next = fix(row)
      // `|| null` on both sides: a missing column and '' are the same text.
      const diff = Object.keys(next).filter((key) => (row.get(key) || null) !== (next[key] || null))
      if (!diff.length) continue

      if (changed < 10) {
        for (const key of diff.filter((k) => k !== 'rssContentText')) {
          console.log(`${apply ? '' : '[dry] '}${className}/${row.id} ${key}: ${JSON.stringify(row.get(key))} → ${JSON.stringify(next[key])}`)
        }
      }
      changed++
      for (const key of diff) row.set(key, next[key])
      row.set('entitiesDecoded', true)
      dirty.push(row)
    }

    if (apply && dirty.length) await Parse.Object.saveAll(dirty, { useMasterKey: true })
    console.log(`${className}: scanned ${scanned}, ${apply ? 'changed' : 'would change'} ${changed}`)
  }
}

console.log(apply ? 'done' : 'dry run — pass --apply to write')
process.exit(0)
