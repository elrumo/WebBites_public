import DOMPurify from 'dompurify'

/**
 * Feedback posts and comments are user-written HTML (TipTap) or Markdown that
 * now arrives from another service: never hand it to v-html unsanitized.
 * DOMPurify needs a DOM, so the server renders text only and the client fills
 * in the markup.
 */
export function safeHtml(html: unknown): string {
  const value = String(html ?? '')
  if (!import.meta.client) return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return DOMPurify.sanitize(value, { ADD_ATTR: ['target'] })
}
