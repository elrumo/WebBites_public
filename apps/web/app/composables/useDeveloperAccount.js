import { computed } from 'vue'
import Parse from 'parse'
import { useStore } from '~/stores/myStore'

/**
 * The signed-in half of the developer docs: keys, usage and webhooks.
 *
 * The API keys panel, the usage panel, the webhooks guide and the playground
 * all need some of the same three lists, so the state lives in `useState` and
 * the loaders are no-ops once something has already fetched them.
 */
export const useDeveloperAccount = () => {
  const store = useStore()
  const { showAlert } = store
  const { backendFetch } = useBackendFetch()

  const currentUser = useState('devdocs:user', () => null)
  const keys = useState('devdocs:keys', () => [])
  const webhooks = useState('devdocs:webhooks', () => [])
  const usage = useState('devdocs:usage', () => null)
  const loading = useState('devdocs:loading', () => ({
    keys: false, createKey: false, revoke: '',
    webhooks: false, createWebhook: false, deleteWebhook: '', test: '',
    usage: false,
  }))

  const fail = (error, fallback) => showAlert({
    type: 'error',
    message: error?.data?.statusMessage || error?.data?.message || error?.message || fallback,
  })

  /** Parse keeps the session in localStorage, so this is synchronous on the client. */
  const refreshUser = () => {
    if (import.meta.client) currentUser.value = Parse.User.current() || null
    return currentUser.value
  }

  const loadKeys = async () => {
    loading.value.keys = true
    try { keys.value = (await backendFetch('keys/list'))?.keys || [] }
    catch (e) { fail(e, 'Could not load API keys') }
    finally { loading.value.keys = false }
  }

  const createKey = async (name) => {
    loading.value.createKey = true
    try {
      await backendFetch('keys/create', { method: 'POST', body: { name: name?.trim() || undefined } })
      await loadKeys()
      showAlert({ type: 'success', message: 'Key created' })
      return true
    } catch (e) { fail(e, 'Could not create key'); return false }
    finally { loading.value.createKey = false }
  }

  const revokeKey = async (key) => {
    loading.value.revoke = key
    try {
      await backendFetch('keys/revoke', { method: 'DELETE', body: { key } })
      keys.value = keys.value.filter(k => k.key !== key)
    } catch (e) { fail(e, 'Could not revoke key') }
    finally { loading.value.revoke = '' }
  }

  const loadWebhooks = async () => {
    loading.value.webhooks = true
    try { webhooks.value = (await backendFetch('api/webhooks'))?.webhooks || [] }
    catch (e) { fail(e, 'Could not load webhooks') }
    finally { loading.value.webhooks = false }
  }

  const createWebhook = async ({ url, description }) => {
    loading.value.createWebhook = true
    try {
      await backendFetch('api/webhooks', {
        method: 'POST',
        body: { url: url.trim(), description: description?.trim() || undefined },
      })
      await loadWebhooks()
      return true
    } catch (e) { fail(e, 'Could not create webhook'); return false }
    finally { loading.value.createWebhook = false }
  }

  const deleteWebhook = async (id) => {
    loading.value.deleteWebhook = id
    try {
      await backendFetch(`api/webhooks/${id}`, { method: 'DELETE' })
      webhooks.value = webhooks.value.filter(w => w.id !== id)
    } catch (e) { fail(e, 'Could not delete webhook') }
    finally { loading.value.deleteWebhook = '' }
  }

  const testWebhook = async (id) => {
    loading.value.test = id
    try {
      const res = await backendFetch(`api/webhooks/${id}/test`, { method: 'POST' })
      showAlert({ type: res?.ok ? 'success' : 'error', message: `Endpoint answered ${res?.status ?? '?'}` })
      await loadWebhooks()
    } catch (e) { fail(e, 'Test delivery failed') }
    finally { loading.value.test = '' }
  }

  const loadUsage = async () => {
    loading.value.usage = true
    try { usage.value = await backendFetch('api/usage') }
    catch (e) { fail(e, 'Could not load usage') }
    finally { loading.value.usage = false }
  }

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      showAlert({ type: 'success', message: 'Copied' })
    } catch { showAlert({ type: 'error', message: 'Could not copy' }) }
  }

  /** Label a key by its name, falling back to the key itself. */
  const keyLabel = (key) => keys.value.find(k => k.key === key)?.name || key

  const keyItems = computed(() => keys.value.map(k => ({
    label: k.name ? `${k.name} (${k.key.slice(0, 12)}…)` : k.key,
    value: k.key,
  })))

  return {
    currentUser, keys, webhooks, usage, loading, keyItems,
    refreshUser, loadKeys, createKey, revokeKey,
    loadWebhooks, createWebhook, deleteWebhook, testWebhook,
    loadUsage, copy, keyLabel, showAlert,
  }
}
