/**
 * Composable for the RSS reader's API calls.
 * Thin wrapper around useBackendFetch() — raw promises, no store coupling,
 * mirroring useBoards().
 *
 * Every route goes through the `/api/v1/*` proxy, which attaches the API key
 * cookie. `/v1/rss` is the only source of feed data: nothing here reads Parse
 * directly, and there is no LiveQuery for feeds in v1.
 *
 * @example
 * const { fetchSubscriptions, subscribeToFeed } = useRssFeeds()
 * const { subscriptions, totalUnread } = await fetchSubscriptions()
 */
export const useRssFeeds = () => {
  const { backendFetch } = useBackendFetch()

  // ── Subscriptions ───────────────────────────────────────────────────

  const fetchSubscriptions = async () => {
    return await backendFetch<{
      success: boolean
      subscriptions: any[]
      totalUnread: number
    }>('rss/subscriptions')
  }

  /** `url` may be a feed, a site that advertises one, or a bare hostname. */
  const subscribeToFeed = async (url: string) => {
    return await backendFetch<{ success: boolean; subscription: any; created: boolean }>(
      'rss/subscriptions',
      { method: 'POST', body: { url } }
    )
  }

  /**
   * Pass `customTitle: null` to clear a rename — omitting the key leaves it
   * alone, which is a different thing.
   *
   * Turning `extractionEnabled` on requires a paid plan; the backend answers
   * 403 with `errorType: 'UsageError'` and `quotaKind: 'rssAutoExtract'`.
   */
  const updateSubscription = async (
    subscriptionId: string,
    updates: { customTitle?: string | null; extractionEnabled?: boolean; sortOrder?: number }
  ) => {
    return await backendFetch<{ success: boolean; subscription: any }>(
      `rss/subscriptions/${subscriptionId}`,
      { method: 'PATCH', body: updates }
    )
  }

  const unsubscribeFromFeed = async (subscriptionId: string) => {
    return await backendFetch<{ success: boolean; subscriptionId: string }>(
      `rss/subscriptions/${subscriptionId}`,
      { method: 'DELETE' }
    )
  }

  // ── Articles ────────────────────────────────────────────────────────

  /**
   * One page of rows, newest first.
   *
   * `nextCursor` tracks the last row the server *scanned*, not the last it
   * returned, so an unread-only page can come back short — or empty — while
   * more remains. Only a null cursor means the end of the list.
   */
  const fetchItems = async (options: {
    subscriptionId?: string | null
    unreadOnly?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const query: Record<string, any> = { limit: options.limit ?? 50 }
    if (options.subscriptionId) query.subscriptionId = options.subscriptionId
    if (options.unreadOnly) query.unreadOnly = true
    if (options.cursor) query.cursor = options.cursor

    return await backendFetch<{ success: boolean; items: any[]; nextCursor: string | null }>(
      'rss/items',
      { query }
    )
  }

  const fetchItem = async (itemId: string) => {
    return await backendFetch<{ success: boolean; item: any }>(`rss/items/${itemId}`)
  }

  /** Idempotent server-side: a retry cannot double-decrement the counter. */
  const markItemRead = async (itemId: string) => {
    return await backendFetch<{ success: boolean; changed: boolean; subscription: any }>(
      `rss/items/${itemId}/read`,
      { method: 'POST' }
    )
  }

  const markItemUnread = async (itemId: string) => {
    return await backendFetch<{ success: boolean; changed: boolean; subscription: any }>(
      `rss/items/${itemId}/unread`,
      { method: 'POST' }
    )
  }

  /** Omit `subscriptionId` to mark every feed read. */
  const markAllRead = async (subscriptionId?: string | null) => {
    return await backendFetch<{ success: boolean; subscriptions: any[] }>('rss/markAllRead', {
      method: 'POST',
      body: subscriptionId ? { subscriptionId } : {}
    })
  }

  // ── Enrichment ──────────────────────────────────────────────────────

  const generateSummary = async (itemId: string) => {
    return await backendFetch<{ success: boolean; aiSummary: any; fromCache: boolean }>(
      `rss/items/${itemId}/summary`,
      { method: 'POST' }
    )
  }

  /**
   * Returns either a ready MP3 (someone already listened to this article) or a
   * signed endpoint to stream from. Audio is cached on the shared article, so
   * the cached case costs no quota at all.
   */
  const requestAudio = async (itemId: string, voice?: string, accent?: string) => {
    return await backendFetch<{
      success: boolean
      endpoint: string | null
      audioUrl: string | null
      cached: boolean
    }>(`rss/items/${itemId}/audio`, { method: 'POST', body: { voice, accent } })
  }

  /**
   * Runs full-text extraction for one article, synchronously. The result lands
   * on the shared row, so re-fetch the item afterwards. 403 `UsageError` with
   * `quotaKind: 'rssAutoExtract'` on free plans.
   */
  const extractItem = async (itemId: string) => {
    return await backendFetch<{ success: boolean; status: 'done' | 'failed' | 'skipped'; message?: string }>(
      `rss/items/${itemId}/extract`,
      { method: 'POST' }
    )
  }

  /** `saved: false` takes the article off the shelf. Idempotent. */
  const setReadLater = async (itemId: string, saved: boolean) => {
    return await backendFetch<{ success: boolean; isReadLater: boolean; changed: boolean }>(
      `rss/items/${itemId}/readLater`,
      { method: 'POST', body: { saved } }
    )
  }

  // ── Discovery & portability ─────────────────────────────────────────

  /** A URL is resolved live; a name searches the shared feed catalogue. */
  const discoverFeeds = async (query: string) => {
    return await backendFetch<{ success: boolean; candidates: any[] }>('rss/discover', {
      query: { query }
    })
  }

  const importOpml = async (opml: string) => {
    return await backendFetch<{
      success: boolean
      subscribed: any[]
      queued: number
      failed: Array<{ xmlUrl: string; reason: string }>
    }>('rss/opml/import', { method: 'POST', body: { opml } })
  }

  /** Returns the OPML document itself, not JSON. */
  const exportOpml = async () => {
    return await backendFetch<string>('rss/opml/export')
  }

  return {
    fetchSubscriptions,
    subscribeToFeed,
    updateSubscription,
    unsubscribeFromFeed,
    fetchItems,
    fetchItem,
    markItemRead,
    markItemUnread,
    markAllRead,
    generateSummary,
    requestAudio,
    extractItem,
    setReadLater,
    discoverFeeds,
    importOpml,
    exportOpml
  }
}
