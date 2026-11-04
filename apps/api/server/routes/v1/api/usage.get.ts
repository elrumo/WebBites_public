import { defineEventHandler } from 'h3'
import { requireUserId } from '#root/server/utils/requireUser'
import { readUsage, API_LIMITS } from '#root/server/utils/publicApi'
import { getUserWithPlan, getPlanTier } from '#root/server/utils/plans'
import { initParseForBoards } from '#root/server/utils/boardUtils'

defineRouteMeta({
  openAPI: {
    tags: ['Developer API'],
    summary: 'This month’s API usage and your plan’s limits',
    responses: { 200: { description: '`{ tier, limits: {perMinute, perMonth}, usage: {month, total, byKey, byGrant} }`' } },
  },
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  initParseForBoards()
  const { plan } = await getUserWithPlan(userId)
  const tier = getPlanTier(plan)
  return { tier, limits: API_LIMITS[tier], usage: await readUsage(userId) }
})
