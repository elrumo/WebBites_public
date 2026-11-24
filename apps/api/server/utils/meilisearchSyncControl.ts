/**
 * Starting, stopping and resuming a Meilisearch sync run. Pure, so it can be
 * tested without Parse or Meilisearch; the IO is in
 * `server/services/meilisearchSync.ts`.
 *
 * A run lives in one backend process, but the stop request can land on any
 * instance behind the load balancer — and a deploy kills the process without
 * the run's `TaskExecution` row ever hearing about it. So the row is the only
 * thing every instance shares: the run beats on it every few seconds, a stop
 * is a flag written to it, and a row that stopped beating is a dead run.
 *
 *   npm run test:meiliSyncControl
 */

/** How often a live run saves its progress and checks for a stop request. */
export const HEARTBEAT_MS = 10_000

/** A run whose row hasn't beaten for this long died with its process. */
export const STALE_MS = 2 * 60_000

export interface RunRow {
  result: string
  updatedAt: Date
  cancelRequested?: boolean
}

/** A run still going in some process — the only kind that blocks a new one. */
export function isLive(run: RunRow | null | undefined, now: number): boolean {
  return !!run && run.result === 'running' && now - run.updatedAt.getTime() < STALE_MS
}

/**
 * Where a resumed run starts in the user list (oldest account first): just
 * after the last user the earlier run finished. Rows written before
 * `lastUserId` existed only have the count, which is as good while no earlier
 * account has been deleted since.
 */
export function resumeIndex(users: string[], previous: { lastUserId?: string; usersDone?: number }): number {
  if (previous.lastUserId) {
    const at = users.indexOf(previous.lastUserId)
    if (at >= 0) return at + 1
  }
  return Math.min(Math.max(0, previous.usersDone ?? 0), users.length)
}

/**
 * Runs `work(i)` for every i in [startAt, count), `concurrency` at a time, and
 * stops taking new ones once `isCancelled()`. Items finish out of order, so
 * `onDone` gets how far the finished items run unbroken from the start: the
 * place a resume may pick up from (anything past it in flight is redone).
 * Settles only once every worker has; rejects with the first error.
 */
export async function forEachConcurrently(
  count: number,
  startAt: number,
  concurrency: number,
  work: (i: number) => Promise<void>,
  { isCancelled = () => false, onDone = (_finishedUpTo: number) => {} } = {},
): Promise<void> {
  let next = startAt
  let upTo = startAt
  const finished = new Set<number>()
  const worker = async () => {
    while (next < count) {
      if (isCancelled()) throw new SyncCancelled()
      const i = next++
      await work(i)
      finished.add(i)
      while (finished.delete(upTo)) upTo++
      onDone(upTo)
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.max(1, concurrency) }, worker))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw (failed as PromiseRejectedResult).reason
}

export type UserRef = { userId: string } | { email: string }

/** What the admin typed into "one user": a Parse objectId or an email. */
export function parseUserRef(input: unknown): UserRef | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (/^[A-Za-z0-9]{6,32}$/.test(value)) return { userId: value }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320) return { email: value.toLowerCase() }
  return null
}

export class SyncCancelled extends Error {
  constructor() {
    super('Sync stopped')
    this.name = 'SyncCancelled'
  }
}

export interface TaskPollClient {
  tasks: {
    getTask(uid: number): Promise<{ uid: number; status: string; error?: { message?: string } | null }>
    cancelTasks(query: { uids: number[] }): PromiseLike<unknown>
  }
}

type FinishedTask = { uid: number; status: string; error?: { message?: string } | null }

const FINAL = new Set(['succeeded', 'failed', 'canceled'])

/**
 * Waits for Meilisearch to finish the given tasks, like the client's own
 * `waitForTasks`, but gives up the moment the run is stopped: the tasks still
 * queued are cancelled in Meilisearch too, so "stop" stops the writes and not
 * just the loop that sent them. Throws `SyncCancelled` then.
 */
export async function waitForSyncTasks(
  client: TaskPollClient,
  uids: number[],
  isCancelled: () => boolean,
  { timeoutMs = 60 * 60_000, intervalMs = 1000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = Date.now } = {},
): Promise<FinishedTask[]> {
  const done = new Map<number, FinishedTask>()
  const deadline = now() + timeoutMs

  for (;;) {
    if (isCancelled()) {
      const pending = uids.filter((uid) => !done.has(uid))
      if (pending.length) await Promise.resolve(client.tasks.cancelTasks({ uids: pending })).catch(() => {})
      throw new SyncCancelled()
    }

    for (const uid of uids) {
      if (done.has(uid)) continue
      const task = await client.tasks.getTask(uid)
      if (FINAL.has(task.status)) done.set(uid, task)
    }
    if (done.size === uids.length) return uids.map((uid) => done.get(uid)!)

    if (now() >= deadline) throw new Error(`Meilisearch tasks ${uids.filter((uid) => !done.has(uid)).join(', ')} not finished after ${Math.round(timeoutMs / 60_000)} min`)
    await sleep(intervalMs)
  }
}
