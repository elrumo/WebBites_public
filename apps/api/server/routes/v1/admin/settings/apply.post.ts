import { defineEventHandler, readBody } from 'h3'
import { requireAdmin } from '#root/server/utils/requireAdmin'
import { restartParse } from '#root/server/utils/settings/parseControl'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Restart services so saved settings take effect (admins only)',
    description: 'Parse and the API exit and are started again by Docker (`restart: unless-stopped`). No Docker socket is involved. `retry` makes Parse try saved settings again after it fell back to the previous ones.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { parse: { type: 'boolean' }, api: { type: 'boolean' }, retry: { type: 'boolean' } } } } } },
    responses: { 202: { description: '`{ parse, api }`: what was asked to restart' } },
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = (await readBody(event)) ?? {}

  const result: { parse: { ok: boolean; reason?: string } | null; api: boolean } = { parse: null, api: false }
  if (body.parse) result.parse = await restartParse(Boolean(body.retry))

  if (body.api) {
    result.api = true
    // After the response has gone out; the container's restart policy starts the process again.
    setTimeout(() => {
      console.log('[settings] restart requested from the admin page; exiting')
      process.exit(0)
    }, 600)
  }

  event.node.res.statusCode = 202
  return result
})
