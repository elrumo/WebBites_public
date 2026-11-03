#!/usr/bin/env bun
/**
 * Repoints rows at the objects Parse actually wrote, for uploads made while
 * parse-compose's `generateKey` picked a random key segment *after* the URL had
 * been built (commit 9ea251d, 2026-09-30, until `fileKeys.js` moved the salt in
 * front of Parse). The object sits at `parse/user/<id>/<rand>_<name>`; the row
 * says `parse/user/<id>/<name>`, which S3 answers with NoSuchKey.
 *
 *   bun run scripts/relink-salted-uploads.ts                # dry run, writes nothing
 *   bun run scripts/relink-salted-uploads.ts --apply --limit=1
 *   bun run scripts/relink-salted-uploads.ts --apply
 *
 *   --since=2026-09-30T00:00:00Z   only objects written, and rows updated, after this
 *   --classes=websites,rssItems,files
 *   --limit=N                      stop after N rows are relinked
 *
 * Each salted object in the bucket maps back to the key a row would have been
 * given. A row is only touched when it names such a key, that key is genuinely
 * missing, and exactly one object could be it — an ambiguous name is reported
 * and left alone, because relinking a row to somebody else's upload is worse
 * than a broken link. Idempotent: a relinked row no longer names a missing key.
 *
 * Saving goes through Parse, so the websites afterSave re-indexes the cards
 * (`OGImage`, `fileUrl`, `images` and `url` are search-relevant keys).
 */
import Parse from 'parse/node.js'
import * as Minio from 'minio'
import { relinkStorageKeys, storageKeysInRow } from '../server/utils/userStorageKeys'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const apply = process.argv.includes('--apply')
const since = new Date(arg('since') || '2026-09-30T00:00:00Z')
const classes = (arg('classes') || 'websites,rssItems,files').split(',')
const limit = Number(arg('limit')) || Infinity

const bucket = process.env.S3_BUCKET as string
const s3 = new Minio.Client({
  endPoint: process.env.S3_ENDPOINT as string,
  useSSL: true,
  accessKey: process.env.S3_ACCESS_KEY as string,
  secretKey: process.env.S3_SECRET_KEY as string,
  region: 'garage',
})

// ─── What is really in the bucket ────────────────────────────────────────────

/** `parse/[user/<id>/]<16 hex>_<name>`: the shape `saltFileName` produced. */
const SALTED = /^(parse\/(?:user\/[^/]+\/)?)[0-9a-f]{16}_(.+)$/

/** The key a row was given -> every object that could be it. */
const written = new Map<string, string[]>()
/**
 * Every key under `parse/`, from the same listing: the answer to "is this key
 * really missing". Not a HEAD per key — the store answers a HEAD for a missing
 * object with 403, not 404, to a key that may list but not read.
 * ponytail: holds every key in memory, fine to a few million objects.
 */
const inBucket = new Set<string>()
await new Promise<void>((resolve, reject) => {
  const stream = s3.listObjectsV2(bucket, 'parse/', true)
  stream.on('data', (item) => {
    if (!item.name) return
    inBucket.add(item.name)
    const match = item.lastModified && item.lastModified >= since && item.name.match(SALTED)
    if (!match) return
    const original = match[1] + match[2]
    written.set(original, [...(written.get(original) ?? []), item.name])
  })
  stream.on('end', resolve)
  stream.on('error', reject)
})
console.log(`${[...written.values()].flat().length} salted objects since ${since.toISOString()} (${inBucket.size} keys under parse/)`)

// ─── The rows ────────────────────────────────────────────────────────────────

const STOP = Symbol('limit reached')
const NOT_COLUMNS = new Set(['objectId', 'createdAt', 'updatedAt', 'ACL'])
const ambiguous: string[] = []
let scanned = 0, relinked = 0, failed = 0

for (const className of classes) {
  try {
    await new Parse.Query(className).greaterThanOrEqualTo('updatedAt', since).each(async (row) => {
      if (++scanned % 5000 === 0) console.log(`  scanned ${scanned}…`)

      const json = row.toJSON() as Record<string, any>
      const moves = new Map<string, string>()
      for (const key of storageKeysInRow(json, bucket)) {
        const found = written.get(key)
        if (!found || inBucket.has(key)) continue
        if (found.length > 1) { ambiguous.push(`${className}/${row.id} ${key}`); continue }
        moves.set(key, found[0])
      }
      if (moves.size === 0) return

      const fixed = relinkStorageKeys(json, bucket, moves)
      const changed = Object.keys(fixed).filter((column) => !NOT_COLUMNS.has(column) && JSON.stringify(fixed[column]) !== JSON.stringify(json[column]))
      console.log(`${className}/${row.id}  ${changed.join(',')}`)
      for (const [from, to] of moves) console.log(`    ${from}\n -> ${to}`)

      if (apply) {
        try {
          for (const column of changed) {
            row.set(column, fixed[column]?.__type === 'File' ? Parse.File.fromJSON(fixed[column]) : fixed[column])
          }
          await row.save(null, { useMasterKey: true })
        } catch (error: any) {
          failed++
          console.error(`    FAILED ${className}/${row.id}: ${error?.message}`)
          return
        }
      }
      if (++relinked >= limit) throw STOP
    }, { useMasterKey: true, batchSize: 500 })
  } catch (error) {
    if (error === STOP) break
    failed++
    console.error(`${className}: scan stopped — ${(error as Error)?.message}`)
  }
}

console.log(`\n${apply ? 'relinked' : 'would relink'} ${relinked} rows (scanned ${scanned}, failed ${failed}, ambiguous ${ambiguous.length})`)
for (const line of ambiguous) console.log(`  ambiguous: ${line}`)
if (!apply && relinked > 0) console.log('dry run — nothing was written. Re-run with --apply (try --limit=1 first).')
process.exit(failed > 0 ? 1 : 0)
