import { getResponseStatus } from 'h3'
import { recordApiMetric } from '../utils/apiMetrics'

/**
 * Times every public developer API request (/v1/api/*) and records it in the
 * hourly Redis buckets read by /v1/admin/api-metrics. Fire-and-forget: a Redis
 * outage never slows or fails the request.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (event.path.startsWith('/v1/api/')) event.context.apiMetricsStart = performance.now()
  })

  nitroApp.hooks.hook('afterResponse', (event, response) => {
    const start = event.context.apiMetricsStart
    if (start === undefined) return

    // Thrown errors arrive as { body: H3Error }; auth failures never reach the router.
    const status = (response?.body as any)?.statusCode || getResponseStatus(event)
    const route = `${event.method} ${event.context.matchedRoute?.path || '(unmatched)'}`
    recordApiMetric(route, status, performance.now() - start, event.context.apiKey?.userId)
      .catch(() => {})
  })
})
