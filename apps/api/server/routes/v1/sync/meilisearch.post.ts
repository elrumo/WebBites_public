import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { describeRun, startMeilisearchSync, SyncRequestError } from '#root/server/services/meilisearchSync'
import { parseUserRef } from '#root/server/utils/meilisearchSyncControl'

// Internal-only (/v1/sync): the web app's admin page calls it through
// /api/admin/meilisearchSync after checking the caller is an admin.
defineRouteMeta({
  openAPI: {
    tags: ['Sync'],
    description: 'Start syncing Parse into both Meilisearch instances in the background, backing up the embeddings to Parse (SearchEmbedding). Poll GET /v1/sync/meilisearch for progress; DELETE stops it.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              dryRun: { type: 'boolean', default: true, description: 'Count what would change without writing. A real run needs an explicit false.' },
              user: { type: 'string', description: 'One account only: its Parse objectId or email.' },
              resume: { type: 'boolean', default: false, description: "Pick up where the latest unfinished run stopped, in that run's mode (dryRun is ignored)." },
              oneWay: { type: 'boolean', default: false, description: 'Only write the indexes from Parse: embeddings Parse holds are still handed back, but none are backed up into SearchEmbedding.' },
            },
          },
        },
      },
    },
    responses: {
      202: { description: 'The run that was started' },
      400: { description: '`user` is neither an objectId nor an email' },
      404: { description: 'No such user' },
      409: { description: 'A run is already going, or there is nothing to resume' },
    },
  },
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)

  let user
  if (body?.user != null && body.user !== '') {
    user = parseUserRef(body.user)
    if (!user) throw createError({ statusCode: 400, statusMessage: 'user must be a user id or an email' })
  }

  try {
    const run = await startMeilisearchSync({ dryRun: body?.dryRun !== false, oneWay: body?.oneWay === true, user, resume: body?.resume === true })
    setResponseStatus(event, 202)
    return { run: describeRun(run) }
  } catch (error: any) {
    if (error instanceof SyncRequestError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    throw error
  }
})
