import Parse from 'parse/node.js'
import { defineEventHandler, getQuery, createError } from 'h3'
import { requireAdmin } from '#root/server/utils/requireAdmin'
import { initParseForBoards } from '#root/server/utils/boardUtils'
import { readApiMetrics } from '#root/server/utils/apiMetrics'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Public developer API metrics (admins only)',
    parameters: [{ in: 'query', name: 'hours', schema: { type: 'integer', default: 168, maximum: 2160 } }],
    responses: { 200: { description: '`{ series, routes, users }` over the last `hours` hours' } },
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  initParseForBoards()

  const metrics = await readApiMetrics(Number(getQuery(event).hours) || 168)

  const ids = metrics.users.map(u => u.userId)
  const found = ids.length
    ? await new Parse.Query(Parse.User).containedIn('objectId', ids).select('email').limit(ids.length).find({ useMasterKey: true })
    : []
  const emails = new Map(found.map(u => [u.id, u.get('email') as string]))

  return { ...metrics, users: metrics.users.map(u => ({ ...u, email: emails.get(u.userId) || null })) }
})
