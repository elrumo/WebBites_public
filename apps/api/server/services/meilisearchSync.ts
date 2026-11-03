import Parse from 'parse/node.js'
import type { EnqueuedTask, Index } from 'meilisearch'
import { MEILISEARCH_CONFIG } from '#root/server/config/meilisearchConfig'
import { meilisearchTargets, type MeiliTarget } from '#root/server/utils/meilisearchTrash'
import { buildMeilisearchDocument } from '#root/server/utils/serverUtils'
import { initParseForBoards } from '#root/server/utils/boardUtils'
import {
  EMBEDDER, embedderKey, encodeVector, planTarget, toIndexDocument,
  type Backup, type SearchDocument,
} from '#root/server/utils/meilisearchSyncPlan'

/** Every user id, paged so a large install does not load them all in one query. */
async function getAllUsersEfficient(): Promise<string[]> {
  const allUserIds: string[] = []
  const limit = 1000
  let skip = 0

  while (true) {
    const users = await new Parse.Query(Parse.User)
      .select('objectId')
      .limit(limit)
      .skip(skip)
      .ascending('createdAt')
      .find({ useMasterKey: true })

    if (users.length === 0) break
    allUserIds.push(...users.map((user: any) => user.id))
    if (users.length < limit) break
    skip += limit
  }

  return allUserIds
}


/**
 * Makes both Meilisearch instances match Parse, user by user, and keeps a copy
 * of the embeddings Meilisearch generates in Parse (`SearchEmbedding`) so an
 * index rebuilt from Parse gets them back without asking OpenAI again. What to
 * do per index is decided in `meilisearchSyncPlan.ts`; this is the IO.
 *
 * Started from the admin page (`POST /v1/sync/meilisearch`), runs in the
 * background, and reports into a `TaskExecution` row that the page polls.
 *
 * ponytail: one user at a time. A few thousand users is minutes; run users in
 * parallel if it gets slow.
 */

export const BACKUP_CLASS = 'SearchEmbedding'
const TASK_NAME = 'meilisearch:sync'
const PAGE = 1000
const WRITE_BATCH = 200
const TASK_WAIT = { timeout: 60 * 60_000, interval: 1000 }
const PROGRESS_EVERY_MS = 15_000
// A run saves progress between users. One that hasn't for this long died with
// its process (a deploy mid-run), so another may start.
const STALE_MS = 3 * 60 * 60_000
const MAX_ERRORS = 50

type Target = MeiliTarget & { index: Index; key: string }
type Counts = { written: number; restored: number; removed: number; backedUp: number; orphanUsers: number; failedTasks: number }

export interface SyncSummary {
  dryRun: boolean
  usersTotal: number
  usersDone: number
  backupsRemoved: number
  targets: Partial<Record<MeiliTarget['label'], Counts>>
  errorCount: number
  errors: Array<{ userId?: string; target?: string; message: string }>
}

const missingClass = (error: any) => {
  // A class nobody has written to yet reads as empty.
  if (error?.code === Parse.Error.INVALID_CLASS_NAME) return []
  throw error
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function recordError(summary: SyncSummary, error: any, where: { userId?: string; target?: string } = {}) {
  summary.errorCount++
  if (summary.errors.length < MAX_ERRORS) summary.errors.push({ ...where, message: error?.message || String(error) })
  console.error('[meilisearchSync]', where, error)
}

async function openTarget(target: MeiliTarget): Promise<Target> {
  const index = target.client.index(MEILISEARCH_CONFIG.INDEX_NAME)
  const [embedders, searchable] = await Promise.all([index.getEmbedders(), index.getSearchableAttributes()])
  const embedder = embedders?.[EMBEDDER]
  if (!embedder) {
    throw new Error(`${target.label} has no '${EMBEDDER}' embedder; apply the index settings first (/v1/search/dev/migrateToMeilisearch?settings=true)`)
  }
  return { ...target, index, key: embedderKey(embedder, searchable) }
}

async function indexDocsOf(index: Index, userId: string): Promise<Map<string, SearchDocument>> {
  const docs = new Map<string, SearchDocument>()
  for (let offset = 0; ; offset += PAGE) {
    const { results } = await index.getDocuments<SearchDocument>({ filter: `userId = ${JSON.stringify(userId)}`, limit: PAGE, offset })
    for (const doc of results) docs.set(doc.id, doc)
    if (results.length < PAGE) return docs
  }
}

/** Every row of a user's in `className`, paged by objectId so a delete mid-read can't skip one. */
async function rowsOf(className: string, userId: string): Promise<Parse.Object[]> {
  const rows: Parse.Object[] = []
  for (;;) {
    const query = new Parse.Query(className)
      .equalTo('user', Parse.User.createWithoutData(userId))
      .ascending('objectId')
      .limit(PAGE)
    if (rows.length) query.greaterThan('objectId', rows[rows.length - 1].id)
    const page: Parse.Object[] = await query.find({ useMasterKey: true }).catch(missingClass)
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

async function syncUser(userId: string, targets: Target[], summary: SyncSummary) {
  const { dryRun } = summary

  // The indexes are read before Parse. A bookmark saved in between is then
  // only missing from an index and gets written; read the other way round, it
  // would be in the index but not in Parse, and be removed.
  const indexed = new Map<string, Map<string, SearchDocument>>()
  for (const target of targets) {
    try {
      indexed.set(target.label, await indexDocsOf(target.index, userId))
    } catch (error) {
      recordError(summary, error, { userId, target: target.label })
    }
  }

  // Built from the Parse object, as the save path builds them.
  const docs: SearchDocument[] = (await rowsOf('websites', userId))
    .map((site) => JSON.parse(JSON.stringify(buildMeilisearchDocument(site))))
  const rows = new Map((await rowsOf(BACKUP_CLASS, userId)).map((row) => [row.get('websiteId') as string, row]))
  const backups = new Map<string, Backup>([...rows].map(([id, row]) => [id, { textHash: row.get('textHash'), vector: row.get('vector') }]))
  const changed = new Set<Parse.Object>()

  // In order, so an index missing bookmarks (alt) is planned against the
  // embeddings just backed up from the other (primary).
  for (const target of targets) {
    const indexDocs = indexed.get(target.label)
    if (!indexDocs) continue
    const counts = summary.targets[target.label]!
    try {
      const plan = planTarget(docs, indexDocs, backups, target.key)
      counts.written += plan.write.length
      counts.restored += plan.write.filter((w) => w.vector !== undefined).length
      counts.removed += plan.remove.length

      if (dryRun) {
        // Counted, not fetched: a first dry run would otherwise pull every embedding.
        for (const id of plan.backUp) backups.set(id, { textHash: plan.hashes.get(id)!, vector: '' })
        counts.backedUp += plan.backUp.length
        continue
      }

      for (const ids of chunks(plan.backUp, 100)) {
        const { results } = await target.index.getDocuments<SearchDocument>({ ids, fields: ['id'], retrieveVectors: true, limit: ids.length })
        for (const doc of results) {
          const vector: number[] | undefined = doc._vectors?.[EMBEDDER]?.embeddings?.[0]
          if (!vector?.length) continue
          const backup = { textHash: plan.hashes.get(doc.id)!, vector: encodeVector(vector) }
          backups.set(doc.id, backup)
          let row = rows.get(doc.id)
          if (!row) {
            row = new Parse.Object(BACKUP_CLASS)
            row.set({ user: Parse.User.createWithoutData(userId), websiteId: doc.id })
            // Derived from the user's bookmarks: master key only, whatever the class permissions.
            row.setACL(new Parse.ACL())
            rows.set(doc.id, row)
          }
          row.set(backup)
          changed.add(row)
          counts.backedUp++
        }
      }

      const tasks: EnqueuedTask[] = []
      for (const batch of chunks(plan.write, WRITE_BATCH)) {
        tasks.push(await target.index.addDocuments(batch.map(toIndexDocument), { primaryKey: 'id' }))
      }
      if (plan.remove.length) tasks.push(await target.index.deleteDocuments(plan.remove))
      for (const task of tasks.length ? await target.client.tasks.waitForTasks(tasks, TASK_WAIT) : []) {
        if (task.status === 'succeeded') continue
        counts.failedTasks++
        recordError(summary, task.error?.message || `task ${task.uid} ${task.status}`, { userId, target: target.label })
      }
    } catch (error) {
      recordError(summary, error, { userId, target: target.label })
    }
  }

  // Backups of bookmarks that are gone from Parse go too.
  const live = new Set(docs.map((doc) => doc.id))
  const gone = [...rows].filter(([id]) => !live.has(id)).map(([, row]) => row)
  summary.backupsRemoved += gone.length
  if (dryRun) return
  for (const batch of chunks([...changed], 50)) await Parse.Object.saveAll(batch, { useMasterKey: true })
  for (const batch of chunks(gone, 100)) await Parse.Object.destroyAll(batch, { useMasterKey: true })
}

/** Documents of users who no longer exist, e.g. from a deletion that missed the index. */
async function removeOrphanUsers(target: Target, users: Set<string>, summary: SyncSummary) {
  // ponytail: facets stop at maxValuesPerFacet (10k users); past that some orphans wait for a later run.
  const { facetDistribution } = await target.index.search('', { facets: ['userId'], limit: 0 })
  const candidates = Object.keys(facetDistribution?.userId ?? {}).filter((id) => !users.has(id))
  if (!candidates.length) return

  // Someone who signed up after the user list was read is not an orphan.
  const found = await new Parse.Query(Parse.User).containedIn('objectId', candidates).limit(candidates.length).find({ useMasterKey: true })
  const exists = new Set(found.map((user) => user.id))
  const orphans = candidates.filter((id) => !exists.has(id))
  summary.targets[target.label]!.orphanUsers += orphans.length
  if (summary.dryRun) return

  for (const id of orphans) {
    await target.index.deleteDocuments({ filter: `userId = ${JSON.stringify(id)}` }).waitTask(TASK_WAIT)
  }
}

async function run(summary: SyncSummary, saveProgress: () => Promise<void>) {
  const targets = await Promise.all(meilisearchTargets().map(openTarget))
  for (const target of targets) {
    summary.targets[target.label] = { written: 0, restored: 0, removed: 0, backedUp: 0, orphanUsers: 0, failedTasks: 0 }
  }

  const users = await getAllUsersEfficient()
  summary.usersTotal = users.length
  await saveProgress()

  let savedAt = Date.now()
  for (const userId of users) {
    try {
      await syncUser(userId, targets, summary)
    } catch (error) {
      recordError(summary, error, { userId })
    }
    summary.usersDone++
    if (Date.now() - savedAt > PROGRESS_EVERY_MS) {
      await saveProgress()
      savedAt = Date.now()
    }
  }

  const userSet = new Set(users)
  for (const target of targets) {
    try {
      await removeOrphanUsers(target, userSet, summary)
    } catch (error) {
      recordError(summary, error, { target: target.label })
    }
  }
}

// ─── Runs ───────────────────────────────────────────────────────────────────

let running = false

export async function latestRun(): Promise<Parse.Object | undefined> {
  initParseForBoards()
  return new Parse.Query('TaskExecution')
    .equalTo('taskName', TASK_NAME)
    .descending('createdAt')
    .first({ useMasterKey: true })
}

export function describeRun(run?: Parse.Object) {
  if (!run) return null
  return {
    id: run.id,
    result: run.get('result') as 'running' | 'success' | 'error',
    message: run.get('message') as string,
    startedAt: run.createdAt,
    updatedAt: run.updatedAt,
    executionTimeMs: run.get('executionTimeMs') as number | undefined,
    summary: run.get('payload') as SyncSummary,
  }
}

/** Starts a run in the background, or returns null while one is going. */
export async function startMeilisearchSync(dryRun: boolean): Promise<Parse.Object | null> {
  if (running) return null
  running = true
  try {
    const last = await latestRun()
    if (last?.get('result') === 'running' && Date.now() - last.updatedAt.getTime() < STALE_MS) {
      running = false
      return null
    }

    const summary: SyncSummary = {
      dryRun, usersTotal: 0, usersDone: 0, backupsRemoved: 0, targets: {}, errorCount: 0, errors: [],
    }
    const record = new Parse.Object('TaskExecution')
    record.set({
      taskName: TASK_NAME, result: 'running', message: dryRun ? 'Dry run' : 'Sync',
      executionDate: new Date(), triggerSource: 'manual', payload: summary,
    })
    record.setACL(new Parse.ACL())
    await record.save(null, { useMasterKey: true })

    const started = Date.now()
    const save = (fields: Record<string, any> = {}) =>
      record.save({ payload: summary, executionTimeMs: Date.now() - started, ...fields }, { useMasterKey: true }).then(() => {})

    run(summary, save)
      .then(() => save({
        result: 'success',
        message: `${dryRun ? 'Dry run' : 'Sync'} finished${summary.errorCount ? ` with ${summary.errorCount} errors` : ''}`,
      }))
      .catch((error) => {
        recordError(summary, error)
        return save({ result: 'error', message: error?.message || String(error) })
      })
      .catch((error) => console.error('[meilisearchSync] Could not record the result:', error))
      .finally(() => { running = false })

    return record
  } catch (error) {
    running = false
    throw error
  }
}

/** For the afterDelete trigger: a bookmark that is gone takes its embedding backup with it. */
export async function removeEmbeddingBackups(websiteIds: string[]): Promise<void> {
  if (!websiteIds.length) return
  initParseForBoards()
  const rows: Parse.Object[] = await new Parse.Query(BACKUP_CLASS)
    .containedIn('websiteId', websiteIds)
    .limit(websiteIds.length)
    .find({ useMasterKey: true })
    .catch(missingClass)
  if (rows.length) await Parse.Object.destroyAll(rows, { useMasterKey: true })
}
