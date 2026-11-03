/**
 * The AI assistants (MCP clients) let into the library through the OAuth
 * consent page, as Settings → AI assistants lists them.
 *
 * A grant is fixed at consent — read only, or read and change — so all there
 * is to do with one afterwards is revoke it. Revoking is immediate: the backend
 * checks the grant on every request and drops its tokens with it.
 *
 * The list lives in `useState` so the developer usage panel can label its
 * per-assistant rows without fetching it a second time.
 */
export const useConnectedApps = () => {
  const { backendFetch } = useBackendFetch()

  const grants = useState('connected-apps:grants', () => [])
  const loaded = useState('connected-apps:loaded', () => false)
  const loading = useState('connected-apps:loading', () => false)
  const revoking = useState('connected-apps:revoking', () => '')

  /** Throws on failure; the caller decides how to say so. */
  const loadGrants = async () => {
    loading.value = true
    try {
      grants.value = (await backendFetch('oauth/grants'))?.grants || []
      loaded.value = true
      return grants.value
    } finally {
      loading.value = false
    }
  }

  /** Throws on failure, leaving the grant in the list. */
  const revokeGrant = async (id) => {
    revoking.value = id
    try {
      await backendFetch(`oauth/grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
      grants.value = grants.value.filter(grant => grant.id !== id)
    } finally {
      revoking.value = ''
    }
  }

  const canWrite = (grant) => Boolean(grant?.scopes?.includes('bookmarks:write'))

  /** The name to show for a grant id, e.g. in a usage breakdown. */
  const grantLabel = (id) => grants.value.find(grant => grant.id === id)?.clientName || null

  return { grants, loaded, loading, revoking, loadGrants, revokeGrant, canWrite, grantLabel }
}
