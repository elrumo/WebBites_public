import { userTagCounts, userTagScope } from './userTags'

export type TagCount = { name: string; count: number }

/**
 * A user's tags with counts, optionally narrowed to those matching `q`, in
 * the order the tag list shows them. Built on `userTags.ts` (the facet
 * distribution, scoped like every search — no trash, no hidden bookmarks);
 * `GET /v1/tags` and the MCP server's `list_tags` both come through here.
 */
export async function listUserTags(
  userId: string,
  { q = '', sort = 'count' }: { q?: string; sort?: 'count' | 'name' } = {},
): Promise<TagCount[]> {
  let all: TagCount[] = await userTagCounts(userId)

  if (q) {
    // Facet search only matches the start of a value ("elon" finds "Elon Musk",
    // "musk" does not), so keep it for typo tolerance and add a substring pass.
    const needle = q.toLowerCase()
    const matched = new Map(all.filter((tag) => tag.name.toLowerCase().includes(needle)).map((tag) => [tag.name, tag]))
    const { index, filter } = await userTagScope(userId)
    const res = await index.searchForFacetValues({ facetName: 'tags', facetQuery: q, filter })
    for (const hit of res.facetHits) matched.set(hit.value, { name: hit.value, count: hit.count })
    all = [...matched.values()]
  }

  all.sort(sort === 'name'
    ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return all
}
