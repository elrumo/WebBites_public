import { defineEventHandler, getRouterParam, createError } from 'h3'
import Parse from 'parse/node.js'
import { requireApiCaller, serializeBookmark } from '#root/server/utils/publicApi'

defineRouteMeta({
  openAPI: {
    tags: ['Developer API'],
    summary: 'Get one bookmark',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The bookmark' }, 404: { description: 'Not yours or not there' } },
  },
})

export default defineEventHandler(async (event) => {
  const caller = await requireApiCaller(event)
  const query = new Parse.Query('websites')
  query.equalTo('user', caller.user)
  query.notEqualTo('isDeleted', true)
  // Same as the list route: a hidden bookmark is not reachable by API token,
  // or fetching one by id would be the way around the list filter.
  query.notContainedIn('hiddenFrom', ['library', 'everywhere'])
  const row = await query.get(String(getRouterParam(event, 'id')), { useMasterKey: true }).catch(() => null)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Bookmark not found' })
  return serializeBookmark(row)
})
