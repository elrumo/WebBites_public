export interface TagRow { name: string; count: number }

/** The user's tags, straight from the search index: live counts, no sync. */
export const useTags = () => {
  const { backendFetch } = useBackendFetch()

  const list = (q = '', page = 0, sort: 'count' | 'name' = 'count', limit = 50) =>
    backendFetch<{ tags: TagRow[]; page: number; total: number; hasMore: boolean }>('tags', {
      query: { q, page, limit, sort }
    })

  /** Rename = `merge([old], new)`, delete = `merge(names, null)`. */
  const merge = (from: string[], into: string | null) =>
    backendFetch<{ updated: number }>('tags/merge', { method: 'POST', body: { from, into } })

  /** First bookmarks carrying `tag`, for a quick preview. Auth scopes the search to the user. */
  const bookmarks = async (tag: string, hitsPerPage = 8) => {
    const res = await backendFetch<any>('search', {
      method: 'POST',
      body: { query: '', filters: `tags = "${tag.replace(/["\\]/g, '\\$&')}"`, page: 0, hitsPerPage }
    })
    return (res?.search?.hits ?? res?.hits ?? []) as any[]
  }

  return { list, merge, bookmarks }
}
