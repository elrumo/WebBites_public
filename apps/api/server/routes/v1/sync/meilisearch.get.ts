import { defineEventHandler } from 'h3'
import { describeRun, latestRun } from '#root/server/services/meilisearchSync'

defineRouteMeta({
  openAPI: {
    tags: ['Sync'],
    description: 'The latest Meilisearch sync run: status, progress and counts per instance.',
    responses: { 200: { description: '`{ run }`, null before the first run' } },
  },
})

export default defineEventHandler(async () => ({ run: describeRun(await latestRun()) }))
