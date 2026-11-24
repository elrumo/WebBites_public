/**
 * Tests for starting, stopping and resuming a Meilisearch sync run. Run:
 *
 *   npm run test:meiliSyncControl
 */

import {
  HEARTBEAT_MS, STALE_MS, SyncCancelled, forEachConcurrently, isLive, parseUserRef, resumeIndex, waitForSyncTasks,
} from './meilisearchSyncControl'

let pass = 0, fail = 0
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.error(`  FAIL ${name}`) }
}

const NOW = 1_000_000_000
const row = (result: string, ageMs: number) => ({ result, updatedAt: new Date(NOW - ageMs) })

// Liveness: only a running row that beat recently blocks a new run.
check('a run that just beat is live', isLive(row('running', HEARTBEAT_MS), NOW))
check('a run that stopped beating is dead', !isLive(row('running', STALE_MS + 1), NOW))
check('the run a deploy killed an hour ago is dead', !isLive(row('running', 60 * 60_000), NOW))
check('a finished run is not live', !isLive(row('success', 0), NOW))
check('a cancelled run is not live', !isLive(row('cancelled', 0), NOW))
check('no run is not live', !isLive(undefined, NOW))
check('a dead run is noticed well within minutes', STALE_MS <= 5 * 60_000 && STALE_MS >= 4 * HEARTBEAT_MS)

// Resume: just after the last user the earlier run finished.
const users = ['u1', 'u2', 'u3', 'u4', 'u5']
check('resumes after lastUserId', resumeIndex(users, { lastUserId: 'u3', usersDone: 3 }) === 3)
check('lastUserId wins over the count', resumeIndex(users, { lastUserId: 'u2', usersDone: 4 }) === 2)
check('falls back to the count (rows from before lastUserId)', resumeIndex(users, { usersDone: 2 }) === 2)
check('falls back to the count when lastUserId was deleted', resumeIndex(users, { lastUserId: 'gone', usersDone: 1 }) === 1)
check('a count past the end is clamped', resumeIndex(users, { usersDone: 99 }) === 5)
check('nothing done starts at the top', resumeIndex(users, {}) === 0)

// One user: an objectId or an email, nothing that could reach a filter otherwise.
check('objectId accepted', JSON.stringify(parseUserRef(' AbC123xyZ9 ')) === JSON.stringify({ userId: 'AbC123xyZ9' }))
check('email accepted, lowercased', JSON.stringify(parseUserRef('Me@Example.com')) === JSON.stringify({ email: 'me@example.com' }))
check('a filter expression is refused', parseUserRef('x" OR userId != "y') === null)
check('empty is refused', parseUserRef('') === null && parseUserRef(undefined) === null && parseUserRef(42) === null)

// Waiting for tasks: returns when all are final, and a stop cancels what is still queued.
function fakeClient(statuses: Record<number, string[]>) {
  const cancelled: number[][] = []
  const calls: Record<number, number> = {}
  return {
    cancelled,
    tasks: {
      async getTask(uid: number) {
        const seq = statuses[uid]
        const i = Math.min(calls[uid] = (calls[uid] ?? -1) + 1, seq.length - 1)
        return { uid, status: seq[i] }
      },
      cancelTasks(query: { uids: number[] }) { cancelled.push(query.uids); return Promise.resolve({}) },
    },
  }
}
const noSleep = { sleep: async () => {}, intervalMs: 0 }

;(async () => {
  {
    const client = fakeClient({ 1: ['enqueued', 'processing', 'succeeded'], 2: ['failed'] })
    const tasks = await waitForSyncTasks(client, [1, 2], () => false, noSleep)
    check('waits until every task is final', tasks.map((t) => t.status).join(',') === 'succeeded,failed')
    check('nothing cancelled when not stopped', client.cancelled.length === 0)
  }

  {
    const client = fakeClient({ 1: ['succeeded'], 2: ['enqueued'], 3: ['processing'] })
    let polls = 0
    let threw: unknown
    try {
      await waitForSyncTasks(client, [1, 2, 3], () => ++polls > 2, noSleep)
    } catch (error) { threw = error }
    check('a stop throws SyncCancelled', threw instanceof SyncCancelled)
    check('a stop cancels only the tasks not yet finished', JSON.stringify(client.cancelled) === JSON.stringify([[2, 3]]))
  }

  {
    const client = fakeClient({ 1: ['enqueued'] })
    let threw: any
    let clock = 0
    try {
      await waitForSyncTasks(client, [1], () => false, { ...noSleep, timeoutMs: 1000, now: () => (clock += 400) })
    } catch (error) { threw = error }
    check('gives up at the deadline with a clear error', threw && !(threw instanceof SyncCancelled) && /not finished/.test(threw.message))
  }

  {
    const client = fakeClient({})
    let threw: unknown
    try { await waitForSyncTasks(client, [], () => true, noSleep) } catch (error) { threw = error }
    check('a stop with nothing queued still stops, and cancels nothing', threw instanceof SyncCancelled && client.cancelled.length === 0)
  }

  // Users several at a time: all of them done, never more than `concurrency` at once,
  // and the resume point only ever covers an unbroken run of finished users.
  {
    const delays = [0, 30, 5, 20, 1, 1, 10, 1]
    const seen: number[] = []
    const marks: number[] = []
    let inFlight = 0, peak = 0
    await forEachConcurrently(delays.length, 1, 3, async (i) => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, delays[i]))
      inFlight--
      seen.push(i)
    }, { onDone: (upTo) => marks.push(upTo) })
    check('every item from startAt is done once', [...seen].sort().join() === '1,2,3,4,5,6,7')
    check('never more than the concurrency at once', peak === 3)
    check('items finish out of order', seen.join() !== '1,2,3,4,5,6,7')
    check('the resume point never runs ahead or back', marks.every((m, i) => i === 0 || m >= marks[i - 1]) && marks.at(-1) === 8)
    // Item 1 (30 ms) is still running when item 2 finishes first: the mark stays at 1.
    check('the resume point waits for a slow earlier item', marks[0] === 1)
  }

  {
    let started = 0
    let threw: unknown
    const control = { cancelled: false }
    try {
      await forEachConcurrently(10, 0, 2, async () => {
        if (++started === 3) control.cancelled = true
        await new Promise((r) => setTimeout(r, 1))
      }, { isCancelled: () => control.cancelled })
    } catch (error) { threw = error }
    check('a stop takes no new items and throws SyncCancelled', threw instanceof SyncCancelled && started <= 4)
  }

  {
    const finished: number[] = []
    let threw: any
    try {
      await forEachConcurrently(4, 0, 2, async (i) => {
        if (i === 0) throw new Error('boom')
        await new Promise((r) => setTimeout(r, 5))
        finished.push(i)
      })
    } catch (error) { threw = error }
    check('an error rejects only after the other workers settle', threw?.message === 'boom' && finished.includes(1))
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
