import { drain, inflightCounts, requestFinished, requestStarted } from '../utils/inflight'

/**
 * Graceful shutdown for the Bun preset, which has none: on SIGTERM the process
 * just died, mid-request and mid-job, and Nitro's `close` hook (which stops the
 * Redis job workers) never ran.
 *
 * On SIGTERM or SIGINT: /health starts answering 503 so the load balancer
 * stops routing here, requests and acknowledged background jobs get up to
 * SHUTDOWN_GRACE_MS to finish, then the `close` hook runs and the process
 * exits. Docker sends SIGKILL 10 s after SIGTERM by default, so the default
 * grace is 8 s; raise both together (`stop_grace_period` in compose).
 */
const GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS) || 8000

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    requestStarted()
    event.context.inflightCounted = true
  })
  const finished = (event: any) => {
    if (!event?.context?.inflightCounted) return
    event.context.inflightCounted = false
    requestFinished()
  }
  nitroApp.hooks.hook('afterResponse', finished)
  nitroApp.hooks.hook('error', (_error, { event }) => finished(event))

  let stopping = false
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`[shutdown] ${signal}: draining`, inflightCounts())
    const left = await drain(GRACE_MS)
    if (left.requests || left.background) console.warn('[shutdown] grace period over with work still running', left)
    try {
      await nitroApp.hooks.callHook('close')
    } catch (error: any) {
      console.error('[shutdown] close hook failed:', error?.message)
    }
    console.log('[shutdown] done')
    process.exit(0)
  }
  process.once('SIGTERM', () => void stop('SIGTERM'))
  process.once('SIGINT', () => void stop('SIGINT'))
})
