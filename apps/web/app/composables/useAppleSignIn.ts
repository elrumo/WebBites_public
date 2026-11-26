/**
 * Whether the sign-in screens offer "Continue with Apple", and the Services ID it signs in with.
 *
 * The hosted service always shows it (it has its own Apple client). A self-hosted install shows it
 * only once an administrator has configured one, which the API reports on a public route. That
 * route is read on the server during SSR and again in the browser on client navigation, so the
 * button never flashes in or out, and a change on the admin page shows at the next load.
 */
export const useAppleSignIn = () => {
  const config = useRuntimeConfig()

  if (!config.public.selfHosted) {
    return { enabled: computed(() => true), clientId: computed(() => 'io.webbites.web') }
  }

  const { data } = useAsyncData(
    'auth-config',
    () => $fetch<{ apple?: { enabled?: boolean, clientId?: string | null } }>('/api/v1/public/auth-config').catch(() => null),
  )
  const clientId = computed(() => data.value?.apple?.clientId || null)
  return { enabled: computed(() => Boolean(data.value?.apple?.enabled && clientId.value)), clientId }
}
