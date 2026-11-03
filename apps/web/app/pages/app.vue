<template>
  <div>
      <AppModals/>

      <div
          class="app-content-shell"
          :class="{ 'app-content-shell--sheet-open': showSettingsModal || showWebsiteModal || showImportBookmarksModal }"
      >
          <BookmarksArea/>

          <!-- Help / Feedback btn -->
          <div class="submit-feedback-float">
              <UPopover>
                  <UButton
                      color="neutral"
                      size="lg"
                      class="rounded-full shadow-md"
                      label="📨"
                  />

                  <template #content>
                      <div class="flex flex-col p-1 min-w-44">
                          <UButton
                              variant="ghost"
                              color="neutral"
                              icon="i-heroicons-question-mark-circle"
                              :label="$t('navigation.help')"
                              to="/help"
                              block
                              class="justify-start"
                          />
                          <UButton
                              variant="ghost"
                              color="neutral"
                              icon="i-heroicons-chat-bubble-left-right"
                              :label="$t('navigation.feedback')"
                              to="/feedback"
                              block
                              class="justify-start"
                          />
                      </div>
                  </template>
              </UPopover>
          </div>
      </div>
  </div>
</template>

<script setup>
import { ref, onBeforeMount, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import Parse from 'parse'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { useScopeUrlSync, parseScopeQuery, typeFilterExpression } from '~/composables/useScopeUrlSync'

definePageMeta({
    middleware: 'auth'
})

const store = useStore()
const router = useRouter()
const { log } = useDevLog()

// Store state
const {
  showSettingsModal,
  userInfo,
  dragImageModal,
  draggedWebsite,
  showImportBookmarksModal,
  importLimit,
  bookmarksToImport,
  selectedBookmarksToImport,
  importAccessData,
  parseConfig,
  showWebsiteModal,
  scrolled
} = storeToRefs(store)


// Store actions
const {
  subscribeToParse,
  getBookmarksToImport,
  fetchUserOptions,
  initialFetch,
  checkStripeStatus,
  fetchSingleWebsite,
  fetchPinnedSites,
  fetchBoards,
  isTauri
} = store

// Capture Nuxt composables synchronously before any async work
const runtimeConfig = useRuntimeConfig()
const ssrSessionToken = useCookie('parse.session')
const ssrApiKey = useCookie('wb_api_key')
const getParse = () => (import.meta.client && window.Parse ? window.Parse : Parse)

// Sidebar scope ↔ URL query (?feed / ?board / ?type / ?private). Registering it
// here ties the watchers to the page lifetime. The scope is applied as soon as
// auth is ready — before the init batch, so a deep-linked view never paints the
// library first — and is usually already hydrated from the server prefetch.
const { applyScopeFromRoute } = useScopeUrlSync()

const mapBoardMembershipItems = (items) => (items || [])
  .filter(item => item?.website?.id)
  .map(item => ({
    ...item.website,
    objectId: item.website.id,
    _boardMembership: {
      membershipId: item.membershipId,
      source: item.source,
      aiTopic: item.aiTopic,
      aiConfidence: item.aiConfidence,
      addedAt: item.addedAt,
      addedBy: item.addedBy
    }
  }))

// Async setup — fetch config + the scope the URL asks for server-side, so the
// client paints the reader/board/type grid directly instead of swapping into it.
const route = useRoute()
const { data: ssrData } = await useAsyncData('app-ssr', async () => {
  let config = null
  let bookmarks = null
  let board = null
  let rss = null
  let privatePrompt = false
  const scope = parseScopeQuery(route.query)

  try {
    const configRes = await $fetch('/api/getParseConfig', { method: 'POST' })
    if (!configRes.error && configRes.attributes) {
      config = configRes.attributes
    }
  } catch (error) {
    console.error("[APP] Error fetching config:", error)
  }

  // Server-side only: fetch content directly from backend
  if (import.meta.server) {
    try {
      const authToken = ssrApiKey.value || ssrSessionToken.value

      if (authToken && ssrSessionToken.value) {
        // Resolve userId from session token
        const { verifySession } = await import('../../server/utils/sessionCache')
        const sessionUser = await verifySession(ssrSessionToken.value)
        const userId = sessionUser?.id

        if (userId) {
          // Server-side render: use the in-network address when there is one.
          const backendUrl = String(runtimeConfig.backendInternalUrl || runtimeConfig.public.backendUrl)
          const baseUrl = backendUrl.endsWith('/') ? backendUrl : `${backendUrl}/`
          const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          }

          if (scope.kind === 'feed') {
            // Subscriptions first so a dead ?feed=<id> can fall back to the
            // library instead of painting an empty reader.
            const subsRes = await $fetch(`${baseUrl}v1/rss/subscriptions`, { headers })
            const subscriptions = subsRes?.subscriptions || []
            const isPseudoScope = scope.value === 'all' || scope.value === 'unread'
            const known = isPseudoScope || subscriptions.some(sub => sub?.id === scope.value)

            if (known) {
              const params = new URLSearchParams({ limit: '50' })
              if (!isPseudoScope) params.set('subscriptionId', scope.value)
              if (scope.value === 'unread') params.set('unreadOnly', 'true')

              const itemsRes = await $fetch(`${baseUrl}v1/rss/items?${params}`, { headers })
              rss = {
                items: itemsRes?.items || [],
                nextCursor: itemsRes?.nextCursor || null,
                subscriptions,
                totalUnread: subsRes?.totalUnread ?? 0
              }
              log('[APP SSR] Feed scope', scope.value, 'items', rss.items.length)
            } else {
              scope.kind = 'none'
              scope.value = ''
            }
          } else if (scope.kind === 'board') {
            const [boardsRes, boardRes] = await Promise.all([
              $fetch(`${baseUrl}v1/boards?limit=200`, { headers }),
              $fetch(`${baseUrl}v1/boards/${encodeURIComponent(scope.value)}?limit=40&skip=0`, { headers })
            ])
            const boardsList = boardsRes?.boards || []
            const boardRecord = boardRes?.board || boardsList.find(b => b?.id === scope.value)

            if (boardRecord?.id) {
              board = {
                board: boardRecord,
                items: mapBoardMembershipItems(boardRes?.items),
                totalBookmarks: boardRes?.totalBookmarks || 0,
                boards: boardsList
              }
              log('[APP SSR] Board scope', scope.value, 'items', board.items.length)
            } else {
              scope.kind = 'none'
              scope.value = ''
            }
          } else if (scope.kind === 'private') {
            // The section is password-gated and the unlock is deliberately
            // per-tab, so there is nothing to prefetch here — skip the library
            // and let the client raise the unlock dialog over an empty grid.
            privatePrompt = true
            log('[APP SSR] Private scope — unlock required on the client')
          } else if (scope.kind === 'type') {
            const knownType = store.bookmarkTypes.some(t => t?.value === scope.value)
            if (!knownType) {
              scope.kind = 'none'
              scope.value = ''
            } else {
              const result = await $fetch(`${baseUrl}v1/search`, {
                method: 'POST',
                headers,
                body: {
                  userId,
                  attributesToRetrieve: ['*'],
                  query: '',
                  useEmbeddings: false,
                  orderBy: 'newFirst',
                  hitsPerPage: 40,
                  page: 0,
                  filters: typeFilterExpression(scope.value)
                }
              })

              let searchData = result
              if (searchData.search) {
                searchData = searchData.search
              }

              const hits = searchData.hits || searchData.results || []
              bookmarks = {
                hits,
                nbHits: searchData.totalHits || 0,
                allLoaded: hits.length < 40
              }
              log('[APP SSR] Type scope', scope.value, 'items', hits.length)
            }
          }

          if (scope.kind === 'none') {
            const result = await $fetch(`${baseUrl}v1/search`, {
              method: 'POST',
              headers,
              body: {
                userId,
                attributesToRetrieve: ['*'],
                query: '',
                useEmbeddings: false,
                orderBy: 'newFirst',
                hitsPerPage: 40,
                page: 0
              }
            })

            let searchData = result
            if (searchData.search) {
              searchData = searchData.search
            }

            const hits = searchData.hits || searchData.results || []
            log('[APP SSR] Fetched', hits.length, 'bookmarks')

            if (hits.length > 0) {
              bookmarks = {
                hits,
                nbHits: searchData.totalHits || 0,
                allLoaded: hits.length < 40
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("[APP SSR] Error fetching content:", error?.message || error)
    }
  }

  return { config, bookmarks, board, rss, privatePrompt, scope }
})

// Apply SSR data to store before the first render, so a deep-linked scope shows
// its own surface immediately rather than the library swapping in later.
if (ssrData.value?.config) {
  parseConfig.value = ssrData.value.config
}

const ssrScope = ssrData.value?.scope?.kind || 'none'
if (ssrScope === 'feed' && ssrData.value?.rss) {
  const { items, nextCursor, subscriptions, totalUnread } = ssrData.value.rss
  store.rssScope = ssrData.value.scope.value
  store.rssUnreadOnly = ssrData.value.scope.value === 'unread'
  store.activeRssItem = null
  store.rssItems = items
  store.rssCursor = nextCursor
  store.rssAllLoaded = !nextCursor
  store.rssLoading = false
  store.rssSubscriptions = subscriptions
  store.rssTotalUnread = totalUnread
  store.rssSubscriptionsLoaded = true
  store.loading = false
} else if (ssrScope === 'board' && ssrData.value?.board) {
  const { board: boardRecord, items, totalBookmarks, boards: boardsList } = ssrData.value.board
  store.activeBoard = boardRecord
  store.activeBoardBookmarks = items
  store.activeBoardTotalBookmarks = totalBookmarks
  store.activeBoardPage = 0
  store.activeBoardAllLoaded = items.length < 40
  store.filteredSites = items
  store.savedSites = items
  store.websiteCount = totalBookmarks
  store.boards = boardsList
  store.boardsLoaded = true
  store.loading = false
} else if (ssrScope === 'type' && ssrData.value?.bookmarks) {
  const typeDef = store.bookmarkTypes.find(t => t.value === ssrData.value.scope.value)
  const filter = typeDef
    ? { label: typeDef.label, value: typeDef.value, icon: typeDef.icon, filterType: typeDef.filterType }
    : null
  store.typesFilter = filter && filter.filterType === 'mainType' ? [filter] : []
  store.subTypesFilter = filter && filter.filterType === 'subType' ? [filter] : []
  store.filteredSites = ssrData.value.bookmarks.hits
  store.savedSites = ssrData.value.bookmarks.hits
  store.loading = false
  if (ssrData.value.bookmarks.allLoaded) {
    store.allSitesLoaded = true
  }
} else if (ssrScope === 'private') {
  // Empty grid now; the unlock dialog opens on the client (setting it here
  // would desync the modal's SSR markup).
  store.filteredSites = []
  store.savedSites = []
  store.loading = false
} else if (ssrData.value?.bookmarks?.hits?.length) {
  store.filteredSites = ssrData.value.bookmarks.hits
  store.savedSites = ssrData.value.bookmarks.hits
  store.loading = false
  if (ssrData.value.bookmarks.allLoaded) {
    store.allSitesLoaded = true
  }
  store._ssrHydrated = true
}

// Methods
const onDragEnter = (event) => {
  if (draggedWebsite.value != null || store.draggedBoardId != null || showWebsiteModal.value || showImportBookmarksModal.value || dragImageModal.value || showSettingsModal.value) return
  dragImageModal.value = true
}

const handleScroll = () => {
  // const searchContainer = document.querySelector('.search-bar-container')
  // if (!searchContainer) return window.removeEventListener('scroll', handleScroll)

  if (window.scrollY > 10) {
    scrolled.value = true;
  //   searchContainer.classList.add('scrolled')
  } else {
    scrolled.value = false;
  //   searchContainer.classList.remove('scrolled')
  }
}

const fetchCurrentUser = () => {
  const parseOperationsStart = performance.now()
  try {
    let user = getParse().User?.current?.()

    if (user) {
      userInfo.value = {
        username: user.get('username'),
        email: user.get('email')
      }
      return true
    } else {
      return false
    }
  } catch (error) {
    console.error('error with fetchCurrentUser: ', error)
    return false
  } finally {
    const parseOperationsEnd = performance.now()
    log('[APP] fetchCurrentUser: ', parseOperationsEnd - parseOperationsStart)
  }
}

const initTauriCode = async () => {
}

// Watchers
// TODO: Finish import bookmarks process
watch(importAccessData, (val) => {
  try{
    const user = getParse().User?.current?.()
    importLimit.value =val.quota?.remaining;
    
    if(val?.hasAccess){

      if (user.get('importing')) {
        if (val) {
          selectedBookmarksToImport.value = bookmarksToImport.value
          showImportBookmarksModal.value = true
          getBookmarksToImport()
        } else {
          selectedBookmarksToImport.value = selectedBookmarksToImport.value.slice(0, importLimit.value)
        }
      }
    }
  } catch(error){
    console.error('error with importAccessData watcher: ', error)
  }
}, { deep: true })

// Lifecycle hooks
// onBeforeMount(async () => {
// })

// Track if initialization has started to prevent double mount
let _mountInitialized = false

onMounted(async () => {
  // Prevent double mount execution (SSR hydration issue)
  if (_mountInitialized) {
    log('[APP] Mount already initialized, skipping')
    return
  }
  _mountInitialized = true

  const parseOperationsStart = performance.now()
  const currentUser = getParse().User?.current?.()
  const sessionToken = currentUser?.getSessionToken?.() || useCookie('parse.session').value || null

  // if (!currentUser) {
  //   log('No user found on mount, redirecting')
  //   router.push({ name: 'index' })
  //   return
  // }

  log('[APP] currentUser: ', currentUser)

  if (!currentUser && !sessionToken) {
    router.push({ name: 'index' })
    return
  }

  if (!currentUser && sessionToken) {
    try {
      await getParse().User.become(sessionToken)
    } catch (error) {
      console.error('[APP] Error restoring session from cookie:', error)
      router.push({ name: 'index' })
      return
    }
  }

  fetchCurrentUser()

  // Ensure API key is generated immediately on app load
  // This prevents the middleware warning and ensures the wb_api_key cookie is set
  const { ensureApiKey } = useAuth()
  try {
    await ensureApiKey()
  } catch (error) {
    console.error('[APP] Error generating API key:', error)
  }

  // Apply the URL scope before the init batch. A server-prefetched scope is
  // already in the store (this is a no-op then); a client-side navigation or a
  // missing prefetch gets its content here. Private raises the unlock dialog
  // immediately instead of flashing the library first.
  try {
    await applyScopeFromRoute()
  } catch (error) {
    console.error('error applying scope from URL: ', error)
  }

  window.addEventListener('scroll', handleScroll)
  window.addEventListener('dragenter', onDragEnter)

  // InititalFetch
  try {
    await Promise.all([
      // fetchPinnedSites(),
      fetchUserOptions(),
      initialFetch(),
      subscribeToParse(),
      checkStripeStatus(),
      // Fetch boards after main init — the API key cookie needs time to be set after login
      // fetchBoards()
    ])
  } catch (error) {
    console.error("error in onMounted: ", error)
  } finally {
    log('[APP] initialFetch promises: ', performance.now() - parseOperationsStart, 'ms')
  }

  try {
    const params = Object.fromEntries(new URLSearchParams(window.location.search))
    if(params.bookmarkId){
      await fetchSingleWebsite(params.bookmarkId);
      showWebsiteModal.value = true
    }
  } catch (error) {
    console.error('error in onMounted: ', error)
  }

  initTauriCode()
})

onBeforeUnmount(() => {
  try {
    window.removeEventListener('scroll', handleScroll)

    // Reset the initialization flag so that fresh data is fetched
    // when the user navigates back to /app
    const { resetInitialization } = store
    if (resetInitialization) {
      resetInitialization()
    }
  } catch (error) {
    console.error('error in onBeforeUnmount: ', error)
  }
})
</script>

<style scoped>
.app-content-shell {
  transform: none;
  transform-origin: center top;
  transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
}

.app-content-shell--sheet-open {
  transform: scale(0.985);
}

@media (prefers-reduced-motion: reduce) {
  .app-content-shell {
    transition: none;
  }
}
</style>
