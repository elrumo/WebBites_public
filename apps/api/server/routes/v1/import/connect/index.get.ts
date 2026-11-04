import { defineEventHandler } from 'h3'
import { CONNECTORS } from '#root/server/utils/importConnectors'

defineRouteMeta({
  openAPI: {
    tags: ['Bookmark Import'],
    summary: 'Services bookmarks can be imported from directly',
    responses: { 200: { description: '`{ services: [{ id, name, auth, hint, note, available }] }`' } },
  },
})

export default defineEventHandler(() => ({
  services: CONNECTORS.map((c) => ({
    ...c,
    available:
      c.auth !== 'unavailable' && (c.id !== 'raindrop' || Boolean(process.env.RAINDROP_CLIENT_ID && process.env.RAINDROP_CLIENT_SECRET)),
  })),
}))
