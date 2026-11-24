import Parse from 'parse/node.js'
import type { EnqueuedTask, Index } from 'meilisearch'
import { MEILISEARCH_CONFIG } from '#root/server/config/meilisearchConfig'
import { meilisearchTargets, type MeiliTarget } from '#root/server/utils/meilisearchTrash'
import { buildMeilisearchDocument } from '#root/server/utils/serverUtils'
import { embedderHealth } from '#root/server/utils/meilisearchEmbedder'
import { initParseForBoards } from '#root/server/utils/boardUtils'
import {
  EMBEDDER, embedderKey, encodeVector, planTarget, toIndexDocument,
  type Backup, type SearchDocument,
} from '#root/server/utils/meilisearchSyncPlan'
import {
  HEARTBEAT_MS, SyncCancelled, forEachConcurrently, isLive, resumeIndex, waitForSyncTasks, type UserRef,
} from '#root/server/utils/meilisearchSyncControl'

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
 * background, and reports into a `TaskExecution` row that the page polls. The
 * row is also how a run is stopped (`DELETE`) from whichever instance the
 * request lands on, and how a run killed by a deploy is noticed: see
 * `meilisearchSyncControl.ts`.
 *
 * Users go `USERS_AT_ONCE` at a time. Meilisearch spends ~2 s on every batch
 * however small, and one user's write is a few documents: one user at a time
 * made a batch per user per index, ~6 s a user. With several users' writes
 * queued together Meilisearch folds them into one batch (autobatching).
 *
 * A one-way run (`oneWay`) only writes the indexes: it still hands back the
 * embeddings Parse holds, but backs none up and leaves `SearchEmbedding` alone.
 */

export const BACKUP_CLASS = 'SearchEmbedding'
const TASK_NAME = 'meilisearch:sync'
const PAGE = 1000
const WRITE_BATCH = 200
// ponytail: fixed; raise it if Meilisearch batches stay small, lower it if Parse struggles.
const USERS_AT_ONCE = 8
const MAX_ERRORS = 50

type Target = MeiliTarget & { index: Index; key: string }
type Counts = { written: number; restored: number; removed: number; backedUp: number; orphanUsers: number; failedTasks: number }

export interface SyncSummary {
  dryRun: boolean
  /** Parse → the indexes only: no embedding backups written to Parse. */
  oneWay?: boolean
  /** Set when the run covers one account only. */
  userId?: string
  /** Set when the run picked up where an earlier, unfinished one stopped. */
  resumedFrom?: { runId: string; atUser: number }
  /** The last user this run finished, so a resume starts just after it. */
  lastUserId?: string
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

/** Shared between the run's loop and its heartbeat. */
interface RunControl { cancelled: boolean }

/** Thrown past the per-user and per-target catches, which only record ordinary errors. */
const rethrowCancel = (error: unknown) => { if (error instanceof SyncCancelled) throw error }

async function syncUser(userId: string, targets: Target[], summary: SyncSummary, control: RunControl) {
  const { dryRun, oneWay } = summary
  const stopped = () => control.cancelled

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
      if (oneWay) plan.backUp = []
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

      // Asked once per bookmark list rather than per batch; cached for a minute anyway.
      const embed = plan.write.length > 0 ? await embedderHealth.isUp() : true
      const tasks: EnqueuedTask[] = []
      try {
        for (const batch of chunks(plan.write, WRITE_BATCH)) {
          if (stopped()) throw new SyncCancelled()
          tasks.push(await target.index.addDocuments(batch.map((entry) => toIndexDocument(entry, embed)), { primaryKey: 'id' }))
        }
        if (plan.remove.length && !stopped()) tasks.push(await target.index.deleteDocuments(plan.remove))
      } catch (error) {
        // Stopped between batches: the ones already queued are cancelled below.
        if (!(error instanceof SyncCancelled)) throw error
      }
      const uids = tasks.map((task) => task.taskUid)
      for (const task of uids.length ? await waitForSyncTasks(target.client, uids, stopped) : []) {
        if (task.status === 'succeeded') continue
        counts.failedTasks++
        recordError(summary, task.error?.message || `task ${task.uid} ${task.status}`, { userId, target: target.label })
      }
      if (stopped()) throw new SyncCancelled()
    } catch (error) {
      rethrowCancel(error)
      recordError(summary, error, { userId, target: target.label })
    }
  }

  // Backups of bookmarks that are gone from Parse go too.
  const live = new Set(docs.map((doc) => doc.id))
  const gone = [...rows].filter(([id]) => !live.has(id)).map(([, row]) => row)
  if (oneWay) return
  summary.backupsRemoved += gone.length
  if (dryRun) return
  for (const batch of chunks([...changed], 50)) await Parse.Object.saveAll(batch, { useMasterKey: true })
  for (const batch of chunks(gone, 100)) await Parse.Object.destroyAll(batch, { useMasterKey: true })
}

/** Documents of users who no longer exist, e.g. from a deletion that missed the index. */
async function removeOrphanUsers(target: Target, users: Set<string>, summary: SyncSummary, control: RunControl) {
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
    const task = await target.index.deleteDocuments({ filter: `userId = ${JSON.stringify(id)}` })
    await waitForSyncTasks(target.client, [task.taskUid], () => control.cancelled)
  }
}

interface RunPlan {
  /** Every user, oldest account first: the orphan check needs the whole list. */
  users: string[]
  /** Where in `users` to start: past 0 for a resumed run. */
  startAt: number
  /** One account only: the rest of the index, orphans included, is left alone. */
  single: boolean
}

async function run(summary: SyncSummary, control: RunControl, plan: RunPlan) {
  const targets = await Promise.all(meilisearchTargets().map(openTarget))
  for (const target of targets) {
    summary.targets[target.label] = { written: 0, restored: 0, removed: 0, backedUp: 0, orphanUsers: 0, failedTasks: 0 }
  }

  summary.usersTotal = plan.users.length
  summary.usersDone = plan.startAt

  await forEachConcurrently(plan.users.length, plan.startAt, USERS_AT_ONCE, async (i) => {
    const userId = plan.users[i]
    try {
      await syncUser(userId, targets, summary, control)
    } catch (error) {
      rethrowCancel(error)
      recordError(summary, error, { userId })
    }
    summary.usersDone++
  }, {
    isCancelled: () => control.cancelled,
    // Users finish out of order: a resume starts after the last of an unbroken run of them.
    onDone: (upTo) => { if (upTo > plan.startAt) summary.lastUserId = plan.users[upTo - 1] },
  })

  if (plan.single) return
  const userSet = new Set(plan.users)
  for (const target of targets) {
    try {
      await removeOrphanUsers(target, userSet, summary, control)
    } catch (error) {
      rethrowCancel(error)
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
  const result = run.get('result') as 'running' | 'success' | 'error' | 'cancelled'
  const summary = run.get('payload') as SyncSummary
  // Still says "running" but stopped beating: its process ended (a deploy, a crash).
  const stale = result === 'running' && !isLive(rowOf(run), Date.now())
  return {
    id: run.id,
    result,
    stale,
    cancelRequested: run.get('cancelRequested') === true,
    canResume: (stale || result === 'error' || result === 'cancelled')
      && !summary?.userId && (summary?.usersDone ?? 0) < (summary?.usersTotal ?? 0),
    message: run.get('message') as string,
    startedAt: run.createdAt,
    updatedAt: run.updatedAt,
    executionTimeMs: run.get('executionTimeMs') as number | undefined,
    summary,
  }
}

const rowOf = (run: Parse.Object) => ({
  result: run.get('result'),
  updatedAt: run.updatedAt,
  cancelRequested: run.get('cancelRequested') === true,
})

/** A start or stop that can't go ahead, with the status the route should answer. */
export class SyncRequestError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

/** The run going in this process, so a stop that lands here takes effect at once. */
const localRuns = new Map<string, RunControl>()

async function resolveUser(ref: UserRef): Promise<string> {
  if ('userId' in ref) {
    const user = await new Parse.Query(Parse.User).get(ref.userId, { useMasterKey: true }).catch(() => null)
    if (!user) throw new SyncRequestError(404, `No user with id ${ref.userId}`)
    return user.id
  }
  const user = await new Parse.Query(Parse.User).equalTo('email', ref.email).first({ useMasterKey: true })
    ?? await new Parse.Query(Parse.User).equalTo('username', ref.email).first({ useMasterKey: true })
  if (!user) throw new SyncRequestError(404, `No user with email ${ref.email}`)
  return user.id
}

export interface StartOptions {
  dryRun: boolean
  /** Write the indexes from Parse without backing up embeddings into Parse. */
  oneWay?: boolean
  /** One account instead of all of them. */
  user?: UserRef
  /** Pick up where the latest, unfinished run stopped — in that run's mode. */
  resume?: boolean
}

/** Starts a run in the background. Throws `SyncRequestError` when it can't. */
export async function startMeilisearchSync(options: StartOptions): Promise<Parse.Object> {
  if (running) throw new SyncRequestError(409, 'A Meilisearch sync is already running')
  running = true
  try {
    const last = await latestRun()
    if (last && isLive(rowOf(last), Date.now())) {
      throw new SyncRequestError(409, last.get('cancelRequested') ? 'The last run is still stopping; try again in a few seconds' : 'A Meilisearch sync is already running')
    }

    let dryRun = options.dryRun
    let oneWay = options.oneWay === true
    let plan: RunPlan
    let resumedFrom: SyncSummary['resumedFrom']
    if (options.user) {
      plan = { users: [await resolveUser(options.user)], startAt: 0, single: true }
    } else if (options.resume) {
      const previous = describeRun(last)
      if (!previous?.canResume) throw new SyncRequestError(409, 'There is no unfinished run to resume')
      // A dry run looked at users without writing them: resuming it as a real
      // run would skip them for good. So a resume keeps the earlier run's mode.
      dryRun = previous.summary.dryRun
      oneWay = previous.summary.oneWay === true
      const users = await getAllUsersEfficient()
      const startAt = resumeIndex(users, previous.summary)
      plan = { users, startAt, single: false }
      resumedFrom = { runId: previous.id, atUser: startAt }
    } else {
      plan = { users: await getAllUsersEfficient(), startAt: 0, single: false }
    }

    // The row the earlier run left saying "running" is closed off, so the page
    // stops showing a run that is long dead.
    if (last?.get('result') === 'running') {
      await last.save({ result: 'cancelled', message: 'Stopped responding (its process ended, e.g. a deploy)' }, { useMasterKey: true })
    }

    const summary: SyncSummary = {
      dryRun, usersTotal: plan.users.length, usersDone: plan.startAt, backupsRemoved: 0, targets: {}, errorCount: 0, errors: [],
      ...(oneWay ? { oneWay } : {}),
      ...(plan.single ? { userId: plan.users[0] } : {}),
      ...(resumedFrom ? { resumedFrom } : {}),
    }
    const record = new Parse.Object('TaskExecution')
    record.set({
      taskName: TASK_NAME, result: 'running',
      message: `${dryRun ? 'Dry run' : 'Sync'}${oneWay ? ' (one way)' : ''}${plan.single ? ' of one user' : ''}${resumedFrom ? ' (resumed)' : ''}`,
      executionDate: new Date(), triggerSource: 'manual', payload: summary,
    })
    record.setACL(new Parse.ACL())
    await record.save(null, { useMasterKey: true })

    const control: RunControl = { cancelled: false }
    localRuns.set(record.id, control)
    const started = Date.now()

    // One save at a time: the heartbeat and the final save share the row.
    let saving: Promise<void> = Promise.resolve()
    const save = (fields: Record<string, any> = {}) => {
      saving = saving
        .then(() => record.save({ payload: summary, executionTimeMs: Date.now() - started, ...fields }, { useMasterKey: true }))
        .then(() => {}, (error) => console.error('[meilisearchSync] Could not save progress:', error))
      return saving
    }

    // Progress, a sign of life, and the place a stop from another instance is heard.
    let beating = false
    const heartbeat = setInterval(async () => {
      if (beating) return
      beating = true
      try {
        await save()
        const flags = await new Parse.Query('TaskExecution').select('cancelRequested').get(record.id, { useMasterKey: true })
        if (flags.get('cancelRequested') === true) control.cancelled = true
      } catch (error) {
        console.error('[meilisearchSync] Heartbeat failed:', error)
      } finally {
        beating = false
      }
    }, HEARTBEAT_MS)

    run(summary, control, plan)
      .then(() => save({
        result: 'success',
        message: `${dryRun ? 'Dry run' : 'Sync'} finished${summary.errorCount ? ` with ${summary.errorCount} errors` : ''}`,
      }))
      .catch((error) => {
        if (error instanceof SyncCancelled) {
          return save({ result: 'cancelled', message: `Stopped after ${summary.usersDone} of ${summary.usersTotal} users` })
        }
        recordError(summary, error)
        return save({ result: 'error', message: error?.message || String(error) })
      })
      .finally(() => {
        clearInterval(heartbeat)
        localRuns.delete(record.id)
        running = false
      })

    return record
  } catch (error) {
    running = false
    throw error
  }
}

/**
 * Stops the latest run. A live one is flagged and stops within a heartbeat —
 * at once if it runs in this process — cancelling its queued Meilisearch tasks
 * on the way out. One that died without saying so is simply closed off.
 */
export async function cancelMeilisearchSync(): Promise<Parse.Object> {
  const last = await latestRun()
  if (!last || last.get('result') !== 'running') throw new SyncRequestError(409, 'No sync is running')

  const local = localRuns.get(last.id)
  if (local) local.cancelled = true

  if (isLive(rowOf(last), Date.now())) {
    await last.save({ cancelRequested: true }, { useMasterKey: true })
  } else {
    await last.save({ result: 'cancelled', cancelRequested: true, message: 'Stopped responding (its process ended, e.g. a deploy)' }, { useMasterKey: true })
  }
  return last
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
