import { createError, defineEventHandler } from 'h3'
import { cancelMeilisearchSync, describeRun, SyncRequestError } from '#root/server/services/meilisearchSync'

// Internal-only (/v1/sync), like the rest of the sync routes.
defineRouteMeta({
  openAPI: {
    tags: ['Sync'],
    description: "Stop the running Meilisearch sync. Its queued Meilisearch tasks are cancelled and it stops within a few seconds, whichever instance runs it. A run whose process died (a deploy) is closed at once.",
    responses: {
      200: { description: 'The run, flagged to stop (or already closed)' },
      409: { description: 'No sync is running' },
    },
  },
})

export default defineEventHandler(async () => {
  try {
    return { run: describeRun(await cancelMeilisearchSync()) }
  } catch (error: any) {
    if (error instanceof SyncRequestError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    throw error
  }
})
