import { defineEventHandler } from 'h3'
import { requireAdmin } from '#root/server/utils/requireAdmin'
import { parseStatus } from '#root/server/utils/settings/parseControl'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Are the services up, and did Parse start with the saved settings? (admins only)',
    responses: { 200: { description: '`{ api, parse }`' } },
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { api: { up: true, uptimeSeconds: Math.round(process.uptime()) }, parse: await parseStatus() }
})
