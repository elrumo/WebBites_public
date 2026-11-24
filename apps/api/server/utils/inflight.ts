/**
 * What this process is still doing, so a shutdown can wait for it.
 *
 * Queue deliveries are acknowledged before their work runs (QStash would time
 * out otherwise; see utils/jobs/processJob.js), so once the 200 has gone the
 * job exists only here. A deploy used to kill the process with that work half
 * done: a bookmark saved without its screenshot, summary or tags, and nothing
 * retried it because the queue had been told it succeeded.
 */

const background = new Set<Promise<unknown>>()
let requests = 0
let draining = false

/** Keeps `promise` on the books until it settles. Returns it unchanged. */
export function trackBackground<T>(promise: Promise<T>): Promise<T> {
  background.add(promise)
  const forget = () => background.delete(promise)
  promise.then(forget, forget)
  return promise
}

export function requestStarted() {
  requests++
}

export function requestFinished() {
  requests = Math.max(0, requests - 1)
}

export function isDraining() {
  return draining
}

export function inflightCounts() {
  return { requests, background: background.size }
}

/**
 * Stop taking new work and wait until nothing is in flight, or `timeoutMs`
 * passes. Resolves with what was still running at the end.
 */
export async function drain(timeoutMs: number): Promise<{ requests: number; background: number }> {
  draining = true
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && (requests > 0 || background.size > 0)) {
    const left = deadline - Date.now()
    await Promise.race([
      Promise.allSettled([...background]),
      new Promise((resolve) => setTimeout(resolve, Math.min(250, left))),
    ])
  }
  return inflightCounts()
}
