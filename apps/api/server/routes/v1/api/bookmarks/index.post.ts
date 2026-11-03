import { defineEventHandler, readBody, createError } from 'h3'
import { requireApiCaller, serializeBookmark } from '#root/server/utils/publicApi'
import { SaveBookmark } from '#root/server/routes/v1/content/saveBookmark'
import { enqueueEnrichment } from '#root/server/utils/jobs/processJob.js'
import { isUrlAnImage } from '#root/server/utils/serverUtils.js'

defineRouteMeta({
  openAPI: {
    tags: ['Developer API'],
    summary: 'Save a bookmark',
    description: 'Saves a URL the same way the apps do: metadata, screenshot and tags are filled in by the pipeline. Fires `bookmark.saved` on your webhooks.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', example: 'https://example.com/article' },
              tags: { type: 'array', items: { type: 'string' } },
              note: { type: 'string', description: 'A note attached to the bookmark' },
            },
          },
        },
      },
    },
    responses: { 200: { description: 'The saved bookmark' }, 400: { description: 'Bad url' }, 402: { description: 'Bookmark quota reached' } },
  },
})

export default defineEventHandler(async (event) => {
  const caller = await requireApiCaller(event)
  const body = (await readBody(event)) || {}
  const url = String(body.url || '').trim()
  if (!url) throw createError({ statusCode: 400, statusMessage: 'url is required' })

  const result: any = await new SaveBookmark().saveBookmark({
    userId: caller.userId,
    url,
    savedFrom: 'api',
    tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 50) : undefined,
    siteNotes: body.note ? String(body.note) : null,
  })

  if (!result || result.status === 'error') {
    const message = result?.error || 'Could not save bookmark'
    throw createError({
      statusCode: /limit/i.test(message) ? 402 : 400,
      statusMessage: message,
      data: /limit/i.test(message) ? { errorType: 'UsageError', quotaKind: 'bookmarks' } : undefined,
    })
  }
  const saved = result.savedSite ?? result.bookmark ?? result
  const isParseRow = typeof saved?.get === 'function'
  // Screenshot, summary, tags and boards: the same pipeline the apps get.
  // Image bookmarks take their own path inside saveBookmark and need none of it.
  if (isParseRow && saved.id && !isUrlAnImage(url)) {
    void enqueueEnrichment(saved.id, { url, userId: caller.userId, fromCache: true })
  }
  return isParseRow ? serializeBookmark(saved) : saved
})
