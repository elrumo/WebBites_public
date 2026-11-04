import { defineEventHandler, getQuery } from 'h3'
import Parse from 'parse/node.js'
import { requireApiCaller, serializeBookmark } from '#root/server/utils/publicApi'

defineRouteMeta({
  openAPI: {
    tags: ['Developer API'],
    summary: 'List your bookmarks',
    description: 'Newest first. Page with `before` (the `createdAt` of the last item you received).',
    parameters: [
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'tag', in: 'query', schema: { type: 'string' } },
      { name: 'type', in: 'query', schema: { type: 'string', enum: ['website', 'image', 'textNote', 'movie', 'game', 'music'] } },
      { name: 'q', in: 'query', description: 'Case-insensitive match on the title', schema: { type: 'string' } },
    ],
    responses: { 200: { description: '`{ bookmarks, nextBefore }`' }, 401: { description: 'Bad API key' }, 429: { description: 'Rate or usage limit hit' } },
  },
})

export default defineEventHandler(async (event) => {
  const caller = await requireApiCaller(event)
  const { limit, before, tag, type, q } = getQuery(event)
  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 100)

  const query = new Parse.Query('websites')
  query.equalTo('user', caller.user)
  query.notEqualTo('isDeleted', true)
  // Hidden bookmarks stay out of the public API at either level: an API token
  // is a wider audience than the library the user hid them from.
  query.notContainedIn('hiddenFrom', ['library', 'everywhere'])
  query.descending('createdAt')
  query.limit(pageSize)
  if (before) query.lessThan('createdAt', new Date(String(before)))
  if (tag) query.equalTo('tags', String(tag))
  if (type) query.equalTo('type', String(type))
  if (q) query.matches('siteTitle', String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

  const rows = await query.find({ useMasterKey: true })
  const bookmarks = rows.map(serializeBookmark)
  return {
    bookmarks,
    nextBefore: rows.length === pageSize ? bookmarks[bookmarks.length - 1].createdAt : null,
  }
})
