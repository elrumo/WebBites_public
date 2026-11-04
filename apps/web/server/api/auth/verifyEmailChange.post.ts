/**
 * Relays the token from a "confirm your new email" link to the backend.
 *
 * No session needed — the token is the credential, and the link is often
 * opened on a phone that isn't signed in. The backend's error code and message
 * are passed through so the page can say whether the link expired, was
 * already used or lost its address to another account.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { token } = (await readBody(event).catch(() => ({}))) || {}

  try {
    return await $fetch<{ success: boolean, email: string }>(`${backendBaseUrl()}v1/auth/verifyEmailChange`, {
      method: 'POST',
      body: { token },
    })
  } catch (error: any) {
    throw createError({
      statusCode: error?.status || error?.statusCode || 500,
      statusMessage: error?.data?.statusMessage || error?.data?.message || 'Could not verify the email change',
      data: { errorCode: error?.data?.data?.errorCode },
    })
  }
})
