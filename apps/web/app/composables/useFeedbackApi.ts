/**
 * The feedback board lives on HelpBites (support-bites). This is the one place
 * the web app talks to it: reads go out with our public key, so signed-out
 * visitors see the board; writes carry an identity token minted by our own
 * server (`GET /api/support/token`), the same one the chat uses. Admins get
 * `role: "admin"` in that token, which is what lets them moderate.
 *
 * Shapes are HelpBites' `FeedbackPost` / `FeedbackComment` (see its
 * docs/FEEDBACK.md): `id`, `title`, `body`, `type` / `platform` / `status`
 * keys, `voteCount`, `commentCount`, `hasVoted`, `isMine`, `canEdit`,
 * `canDelete`, …
 */

export type FeedbackPost = {
  id: string
  title: string
  body: string
  type: string
  platform: string
  status: string
  statusCategory: 'open' | 'planned' | 'active' | 'done' | 'closed'
  voteCount: number
  commentCount: number
  author: { name: string, isTeam: boolean, externalId?: string, email?: string } | null
  hidden: boolean
  featured: boolean
  showOnChangelog: boolean
  changelogTitle: string
  changelogBody: string
  icon: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
  externalId?: string
  metadata?: Record<string, unknown>
  hasVoted?: boolean
  isMine?: boolean
  canEdit?: boolean
  canDelete?: boolean
}

export type FeedbackComment = {
  id: string
  postId: string
  body: string
  author: FeedbackPost['author']
  createdAt: string
  isMine?: boolean
  canDelete?: boolean
}

export type FeedbackViewer = { signedIn: boolean, isAdmin: boolean, name: string }

export type FeedbackEvent =
  | { type: 'feedback.post.created' | 'feedback.post.updated', postId: string, post: FeedbackPost }
  | { type: 'feedback.post.deleted', postId: string }
  | { type: 'feedback.comment.created', postId: string, comment: FeedbackComment, commentCount: number }
  | { type: 'feedback.comment.deleted', postId: string, commentId: string, commentCount: number }

// Shown to the user as an alert, so it follows the locale; outside a Nuxt context there is no i18n to ask.
const signInMessage = () => {
  try { return useNuxtApp().$i18n.t('alerts.core_store.sign_in_required') } catch { return 'You must be logged in to do that' }
}

export class FeedbackSignInError extends Error {
  constructor() {
    super(signInMessage())
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

// One token for the whole tab, refreshed a minute before it expires.
let cached: { token: string, expiresAt: number, userId: string } | null = null
let inflight: Promise<string | null> | null = null

function currentParseUser(): any {
  return import.meta.client ? (window as any).Parse?.User?.current?.() : null
}

function sessionHeader(): Record<string, string> {
  const token = currentParseUser()?.getSessionToken?.()
  return token ? { 'x-parse-session-token': token } : {}
}

/** A live event carries no viewer fields (`hasVoted`, `isMine`, …): keep ours. */
export function mergeFeedbackPost(local: FeedbackPost | undefined, incoming: FeedbackPost): FeedbackPost {
  if (!local) return { hasVoted: false, isMine: false, canEdit: false, canDelete: false, ...incoming }
  return {
    ...local,
    ...incoming,
    hasVoted: incoming.hasVoted ?? local.hasVoted,
    isMine: incoming.isMine ?? local.isMine,
    canEdit: incoming.canEdit ?? local.canEdit,
    canDelete: incoming.canDelete ?? local.canDelete,
    author: incoming.author?.name || !local.author ? incoming.author : local.author
  }
}

// Resolved once: the store calls in from event handlers, where there is no
// component (and so no Nuxt context) to read the runtime config from.
let settings: { host: string, publicKey: string } | null = null

function resolveSettings() {
  if (settings) return settings
  const runtime = useRuntimeConfig()
  settings = {
    host: String(runtime.public.helpbitesApiUrl || '').replace(/\/+$/, ''),
    publicKey: String(runtime.public.helpbitesPublicKey || '')
  }
  return settings
}

export function useFeedbackApi() {
  const { host, publicKey } = resolveSettings()
  const configured = Boolean(host && publicKey)

  /** The signed-in user's identity token, or null when nobody is signed in. */
  async function getToken(force = false): Promise<string | null> {
    if (!import.meta.client) return null
    const userId = currentParseUser()?.id || ''
    if (!userId) {
      cached = null
      return null
    }
    if (!force && cached && cached.userId === userId && cached.expiresAt - 60_000 > Date.now()) return cached.token
    if (inflight) return inflight
    inflight = $fetch<{ token: string, expiresAt: string }>('/api/support/token', { headers: sessionHeader() })
      .then((result) => {
        cached = { token: result.token, expiresAt: new Date(result.expiresAt).getTime(), userId }
        return result.token
      })
      .catch(() => null)
      .finally(() => { inflight = null })
    return inflight
  }

  async function request<T>(path: string, options: { method?: Method, body?: unknown, query?: Record<string, unknown>, auth?: 'optional' | 'required' | 'none', retried?: boolean } = {}): Promise<T> {
    if (!configured) throw new Error('Feedback is not configured')
    const auth = options.auth || 'optional'
    const token = auth === 'none' ? null : await getToken()
    if (auth === 'required' && !token) throw new FeedbackSignInError()
    try {
      return await $fetch<T>(`${host}/v1${path}`, {
        method: options.method || 'GET',
        body: options.body as any,
        query: token ? options.query : { pk: publicKey, ...options.query },
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
    } catch (error: any) {
      const status = error?.statusCode || error?.status
      if (status === 401 && token && !options.retried) {
        await getToken(true)
        return request<T>(path, { ...options, retried: true })
      }
      if (status === 401) throw new FeedbackSignInError()
      throw new Error(error?.data?.statusMessage || error?.data?.message || error?.message || 'Request failed')
    }
  }

  return {
    configured,
    host,
    publicKey,
    getToken,
    list: (query: Record<string, unknown> = {}, auth: 'optional' | 'none' = 'optional') => request<{ posts: FeedbackPost[], total: number, viewer: FeedbackViewer }>('/feedback', { query, auth }),
    get: (id: string) => request<{ post: FeedbackPost, comments: FeedbackComment[], viewer: FeedbackViewer }>(`/feedback/${encodeURIComponent(id)}`),
    create: (body: Record<string, unknown>) => request<{ post: FeedbackPost }>('/feedback', { method: 'POST', body, auth: 'required' }),
    update: (id: string, body: Record<string, unknown>) => request<{ post: FeedbackPost }>(`/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', body, auth: 'required' }),
    remove: (id: string) => request<{ deleted: boolean }>(`/feedback/${encodeURIComponent(id)}`, { method: 'DELETE', auth: 'required' }),
    vote: (id: string, voted: boolean) => request<{ voted: boolean, post: FeedbackPost }>(`/feedback/${encodeURIComponent(id)}/vote`, { method: 'POST', body: { voted }, auth: 'required' }),
    comment: (id: string, body: string) => request<{ comment: FeedbackComment, post: FeedbackPost }>(`/feedback/${encodeURIComponent(id)}/comments`, { method: 'POST', body: { body }, auth: 'required' }),
    removeComment: (postId: string, commentId: string) => request<{ deleted: boolean, post: FeedbackPost }>(`/feedback/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE', auth: 'required' }),

    /**
     * Live board events over SSE (fetch + a stream reader, so the token can
     * ride in a header — admins then also hear about hidden posts). Reconnects
     * with backoff; returns a stop function. A stream that never connects only
     * costs a log line: the list on screen is already current.
     */
    stream(onEvent: (event: FeedbackEvent) => void, onReconnect?: () => void): () => void {
      if (!import.meta.client || !configured) return () => {}
      let stopped = false
      let controller: AbortController | null = null
      let attempt = 0
      let connectedOnce = false

      const connect = async () => {
        if (stopped) return
        controller = new AbortController()
        const signal = controller.signal
        try {
          const token = await getToken()
          const url = `${host}/v1/feedback/events${token ? '' : `?pk=${encodeURIComponent(publicKey)}`}`
          const res = await fetch(url, { headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal })
          if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`)
          attempt = 0
          if (connectedOnce) onReconnect?.()
          connectedOnce = true
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let index: number
            while ((index = buffer.indexOf('\n\n')) >= 0) {
              const data = buffer.slice(0, index).split('\n').find(line => line.startsWith('data:'))
              buffer = buffer.slice(index + 2)
              if (!data) continue
              try {
                const parsed = JSON.parse(data.slice(5))
                if (typeof parsed?.type === 'string' && parsed.type.startsWith('feedback.')) onEvent(parsed)
              } catch {}
            }
          }
        } catch (error) {
          if (signal.aborted) return
          console.warn('[feedback] live updates dropped:', (error as Error).message)
        }
        if (stopped) return
        attempt += 1
        setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)))
      }

      void connect()
      return () => {
        stopped = true
        controller?.abort()
      }
    }
  }
}
