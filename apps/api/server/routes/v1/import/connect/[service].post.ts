import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { randomBytes } from 'crypto'
import { requireUserId } from '#root/server/utils/requireUser'
import {
  connector,
  fetchPinboard,
  fetchReadwise,
  fetchRaindrop,
  raindropAuthorizeUrl,
  rememberOAuthState,
  takeConnectorToken,
} from '#root/server/utils/importConnectors'

defineRouteMeta({
  openAPI: {
    tags: ['Bookmark Import'],
    summary: 'Fetch bookmarks from a connected service',
    description:
      'Token services (pinboard, readwise) take `{ token }` and answer `{ bookmarks }`. ' +
      'OAuth services (raindrop) answer `{ authorizeUrl }` the first time; after the user approves, call again to get `{ bookmarks }`. ' +
      'Feed the result into `POST /v1/import/importBookmarks`.',
    parameters: [{ name: 'service', in: 'path', required: true, schema: { type: 'string', enum: ['raindrop', 'pinboard', 'readwise'] } }],
    requestBody: {
      content: {
        'application/json': {
          schema: { type: 'object', properties: { token: { type: 'string' }, client: { type: 'string', enum: ['web', 'native'] } } },
        },
      },
    },
    responses: { 200: { description: '`{ bookmarks }` or `{ authorizeUrl }`' }, 401: { description: 'Bad token' }, 410: { description: 'Service no longer exists' } },
  },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const service = connector(String(getRouterParam(event, 'service')))
  const body = (await readBody(event).catch(() => ({}))) || {}

  if (service.id === 'raindrop') {
    const stored = await takeConnectorToken('raindrop', userId)
    if (stored) return { service: service.id, bookmarks: await fetchRaindrop(stored) }
    const state = randomBytes(16).toString('base64url')
    await rememberOAuthState(state, { userId, client: body.client === 'native' ? 'native' : 'web' })
    return { service: service.id, authorizeUrl: raindropAuthorizeUrl(state) }
  }

  const token = String(body.token || '').trim()
  if (!token) throw createError({ statusCode: 400, statusMessage: `${service.name} needs a token` })
  const bookmarks = service.id === 'pinboard' ? await fetchPinboard(token) : await fetchReadwise(token)
  return { service: service.id, bookmarks }
})
