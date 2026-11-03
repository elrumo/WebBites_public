/**
 * Two-way sync between the sidebar scope (board / feed / type / private) and
 * the URL, so a scope is shareable and survives reload, Back and Forward.
 *
 * Query shape on /app (at most one scope param live at a time):
 *   ?type=<value>                  bookmark type filter
 *   ?board=<boardId>               board scope
 *   ?feed=all|unread|<subId>       RSS reader scope
 *   ?private=1                     Private section
 *
 * Unrelated params (`bookmarkId`, modal flags, …) are preserved. Some modals
 * write those with `history.pushState` and bypass vue-router, so the live
 * `window.location` is the source of truth for "what is already in the URL".
 */
import { computed, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const SCOPE_PARAMS = ['feed', 'board', 'type', 'private'] as const

export type ScopeKind = 'feed' | 'board' | 'private' | 'type' | 'none'
export type ParsedScope = { kind: ScopeKind; value: string }
type QueryRecord = Record<string, string>

/** `?feed=a&feed=b` and `?feed=` both collapse to something comparable. */
const normalizeQueryValue = (value: unknown): string => {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(v => String(v ?? '')).join(',')
  return String(value)
}

/**
 * Shared by the client sync and the server prefetch so both agree on which
 * scope a URL asks for, including the priority when several params appear.
 */
export const parseScopeQuery = (query: Record<string, unknown>): ParsedScope => {
  const feed = normalizeQueryValue(query.feed)
  const board = normalizeQueryValue(query.board)
  const type = normalizeQueryValue(query.type)
  const isPrivate = normalizeQueryValue(query.private)

  // The reader surface wins over the grid surfaces — it is the more specific place.
  if (feed) return { kind: 'feed', value: feed }
  if (board) return { kind: 'board', value: board }
  if (isPrivate === '1' || isPrivate === 'true') return { kind: 'private', value: '1' }
  if (type) return { kind: 'type', value: type }
  return { kind: 'none', value: '' }
}

/**
 * `Article` is the only sub-type filter; every other sidebar type filters the
 * main `type` field. Mirrors `bookmarkTypes` in myStore.js.
 */
export const typeFilterExpression = (typeValue: string): string =>
  typeValue === 'article' ? `subType = ${typeValue}` : `type = ${typeValue}`

const isSameQuery = (a: QueryRecord, b: QueryRecord): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (normalizeQueryValue(a[key]) !== normalizeQueryValue(b[key])) return false
  }
  return true
}

export const useScopeUrlSync = () => {
  const route = useRoute()
  const router = useRouter()
  const store = useStore()

  const {
    rssScope,
    activeBoard,
    typesFilter,
    subTypesFilter,
    privateScope,
    privateUnlocked,
    showPrivateUnlockModal,
    rssSubscriptions,
    rssSubscriptionsLoaded,
    rssSubscriptionsLoading,
    boards,
    boardsLoaded,
    boardsLoading,
    bookmarkTypes
  } = storeToRefs(store)

  // Depth counter rather than a boolean: stripping an invalid param re-enters
  // the route watcher while the outer apply is still on the stack.
  let applyDepth = 0
  let syncScheduled = false
  // Serializes applies so rapid Back/Forward cannot interleave two scopes.
  let applyChain: Promise<void> = Promise.resolve()

  const activeTypeValue = computed(
    () => typesFilter.value[0]?.value || subTypesFilter.value[0]?.value || null
  )

  /**
   * One string per logical scope. A single sidebar click mutates several store
   * fields in one tick; collapsing them here means one history entry per click.
   */
  const scopeKey = computed(() => {
    if (rssScope.value !== null) return `feed:${rssScope.value}`
    if (activeBoard.value?.id) return `board:${activeBoard.value.id}`
    if (privateScope.value) return 'private'
    if (activeTypeValue.value) return `type:${activeTypeValue.value}`
    return ''
  })

  /**
   * Live query string. `window.location` wins over `route.query` because
   * `WebsiteModal` and friends push `bookmarkId` with raw `history.pushState`.
   */
  const readUrlQuery = (): QueryRecord => {
    if (import.meta.server) {
      const query: QueryRecord = {}
      for (const [key, value] of Object.entries(route.query)) {
        query[key] = normalizeQueryValue(value)
      }
      return query
    }
    const query: QueryRecord = {}
    new URLSearchParams(window.location.search).forEach((value, key) => {
      query[key] = value
    })
    return query
  }

  const queryWithScope = (): QueryRecord => {
    const query = readUrlQuery()
    for (const key of SCOPE_PARAMS) delete query[key]

    if (rssScope.value !== null) query.feed = String(rssScope.value)
    else if (activeBoard.value?.id) query.board = activeBoard.value.id
    else if (privateScope.value) query.private = '1'
    else if (activeTypeValue.value) query.type = activeTypeValue.value

    return query
  }

  const syncUrlFromStore = () => {
    // Mid route→store application the URL is already the target; pushing here
    // would only add a duplicate history entry.
    if (applyDepth > 0) return
    const next = queryWithScope()
    if (isSameQuery(next, readUrlQuery())) return
    router.push({ query: next })
  }

  const scheduleUrlSync = () => {
    if (syncScheduled) return
    syncScheduled = true
    nextTick(() => {
      syncScheduled = false
      syncUrlFromStore()
    })
  }

  const parseRouteScope = (): ParsedScope => parseScopeQuery(readUrlQuery())

  const applyFeed = async (feed: string): Promise<'ok' | 'invalid'> => {
    if (rssScope.value === feed) return 'ok'

    const isPseudoScope = feed === 'all' || feed === 'unread'
    if (!isPseudoScope) {
      if (!rssSubscriptionsLoaded.value && !rssSubscriptionsLoading.value) {
        await store.fetchRssSubscriptions()
      }
      const known = rssSubscriptions.value.some((sub: { id?: string }) => sub.id === feed)
      if (!known) {
        if (rssScope.value !== null) store.clearRss()
        return 'invalid'
      }
    }

    await store.selectRssScope(feed)
    return 'ok'
  }

  const applyBoard = async (boardId: string): Promise<'ok' | 'invalid'> => {
    if (activeBoard.value?.id === boardId) return 'ok'

    if (!boardsLoaded.value && !boardsLoading.value) {
      await store.fetchBoards()
    }
    const board = boards.value.find((b: { id?: string }) => b.id === boardId)
    if (!board) {
      if (activeBoard.value) store.clearActiveBoard()
      return 'invalid'
    }
    await store.selectBoard(board)
    return 'ok'
  }

  const applyPrivate = async () => {
    if (privateScope.value) return
    if (privateUnlocked.value) {
      await store.enterPrivateScope()
      return
    }
    // Locked: ask for the password first. Unlocking enters the section, and
    // the store → URL watcher keeps ?private=1 in place.
    showPrivateUnlockModal.value = true
  }

  const applyType = async (typeValue: string): Promise<'ok' | 'invalid'> => {
    if (activeTypeValue.value === typeValue) return 'ok'

    const type = bookmarkTypes.value.find((t: { value?: string }) => t.value === typeValue)
    if (!type) {
      if (activeTypeValue.value) store.setSearchType('', true)
      return 'invalid'
    }
    await store.setSearchType(type)
    return 'ok'
  }

  /** Back to the library. Mutual exclusivity means at most one branch runs. */
  const clearScope = () => {
    if (rssScope.value !== null) store.clearRss()
    else if (activeBoard.value) store.clearActiveBoard()
    else if (privateScope.value) store.exitPrivateScope()
    else if (activeTypeValue.value) store.setSearchType('', true)
  }

  const doApplyScopeFromRoute = async () => {
    const scope = parseRouteScope()
    let stripParam: (typeof SCOPE_PARAMS)[number] | null = null

    applyDepth++
    try {
      if (scope.kind === 'feed') {
        if ((await applyFeed(scope.value)) === 'invalid') stripParam = 'feed'
      } else if (scope.kind === 'board') {
        if ((await applyBoard(scope.value)) === 'invalid') stripParam = 'board'
      } else if (scope.kind === 'private') {
        await applyPrivate()
      } else if (scope.kind === 'type') {
        if ((await applyType(scope.value)) === 'invalid') stripParam = 'type'
      } else {
        clearScope()
      }
    } finally {
      applyDepth--
    }

    // Outside the guard: the replace re-enters the route watcher on purpose so
    // the cleaned URL is re-read, and it should not count as a user history step.
    if (stripParam) {
      const query = readUrlQuery()
      delete query[stripParam]
      await router.replace({ query })
    }
  }

  const applyScopeFromRoute = () => {
    applyChain = applyChain.then(doApplyScopeFromRoute).catch(error => {
      console.error('[SCOPE-URL] Failed to apply scope from URL:', error)
    })
    return applyChain
  }

  // Store → URL (sidebar clicks, toggle-offs, leaveReader via search…).
  watch(scopeKey, () => scheduleUrlSync())

  // URL → Store (Back/Forward, hand-edited address bar).
  watch(() => route.fullPath, () => {
    void applyScopeFromRoute()
  })

  return { applyScopeFromRoute, syncUrlFromStore }
}
