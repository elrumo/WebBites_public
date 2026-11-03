import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { describeRun, startMeilisearchSync } from '#root/server/services/meilisearchSync'

// Internal-only (/v1/sync): the web app's admin page calls it through
// /api/admin/meilisearchSync after checking the caller is an admin.
defineRouteMeta({
  openAPI: {
    tags: ['Sync'],
    description: 'Start syncing Parse into both Meilisearch instances in the background, backing up the embeddings to Parse (SearchEmbedding). Poll GET /v1/sync/meilisearch for progress.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              dryRun: { type: 'boolean', default: true, description: 'Count what would change without writing. A real run needs an explicit false.' },
            },
          },
        },
      },
    },
    responses: {
      202: { description: 'The run that was started' },
      409: { description: 'A run is already going' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const run = await startMeilisearchSync(body?.dryRun !== false)
  if (!run) throw createError({ statusCode: 409, statusMessage: 'A Meilisearch sync is already running' })
  setResponseStatus(event, 202)
  return { run: describeRun(run) }
})
