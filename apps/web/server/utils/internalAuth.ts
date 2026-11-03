/**
 * The credential the backend accepts on its internal-only routes.
 *
 * Every call site used to inline a hardcoded `Basic <base64>` literal as a
 * fallback. The backend no longer accepts that credential: the same one shipped
 * inside the browser extensions and inside every audio stream token, so any
 * signed-in user could read it, and it could not be rotated without breaking
 * released clients. It is gone from `validateInternalApiKey`.
 *
 * Set `BACKEND_INTERNAL_AUTH` to `Bearer <CUSTOM_API_KEY>` (the backend's own
 * `CUSTOM_API_KEY`). There is deliberately no fallback — a missing value fails
 * the request loudly instead of quietly sending something world-readable.
 */
export function internalAuthHeader(): string {
  const configured =
    process.env.BACKEND_INTERNAL_AUTH ||
    (process.env.CUSTOM_API_KEY ? `Bearer ${process.env.CUSTOM_API_KEY}` : '')

  if (!configured) {
    throw createError({
      statusCode: 500,
      message:
        'BACKEND_INTERNAL_AUTH is not set, so this internal backend call cannot be authenticated.'
    })
  }

  return configured
}
