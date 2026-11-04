import { defineEventHandler, getQuery } from 'h3';
import { requireAuth } from '#root/server/utils/boardUtils';
import { listUserTags } from '#root/server/utils/tagList';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: "List the caller's tags with bookmark counts",
    description:
      'The tag list is a facet distribution over the search index, so counts are live '
      + 'and case variants of the same tag collapse into one row. With `q`, the facet '
      + 'search endpoint answers with prefix and typo tolerance.',
    parameters: [
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search term; empty lists every tag' },
      { name: 'page', in: 'query', schema: { type: 'integer', default: 0 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
      { name: 'sort', in: 'query', schema: { type: 'string', enum: ['count', 'name'], default: 'count' } },
    ],
    responses: { '200': { description: '{ tags: [{ name, count }], page, total, hasMore }' } },
  },
});

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);
  const query = getQuery(event);
  const q = String(query.q ?? '').trim();
  const page = Math.max(0, Number(query.page) || 0);
  const limit = Math.min(Math.max(1, Number(query.limit) || 100), 500);
  const sort = query.sort === 'name' ? 'name' : 'count';

  const all = await listUserTags(auth.userId, { q, sort });

  const start = page * limit;
  return {
    tags: all.slice(start, start + limit),
    page,
    total: all.length,
    hasMore: start + limit < all.length,
  };
});
