/**
 * Some publishers (The Verge, Vox) write their figures into the JSON-LD
 * article body as `[Image: caption https://…]`. Articles extracted before the
 * backend learned to turn those into markup still carry the literal marker,
 * so the reader expands it into an image here.
 */
const MARKER = /\[Image:\s*([^\]]*?)\s*(https?:\/\/[^\s\]<>"']+)\s*\]/gi

function figure(caption, url) {
  const alt = caption.replace(/"/g, '&quot;')
  const figcaption = caption ? `<figcaption>${caption}</figcaption>` : ''
  return `<figure><img src="${url}" alt="${alt}" loading="lazy" />${figcaption}</figure>`
}

/** Replaces `[Image: …]` markers in reader HTML with `<figure><img>` markup. */
export function expandImageMarkers(html) {
  if (!html || !html.includes('[Image:')) return html
  return html
    // A marker that is a whole paragraph replaces the paragraph — a <figure>
    // inside a <p> is invalid and the browser would split it.
    .replace(/<p>\s*\[Image:\s*([^\]]*?)\s*(https?:\/\/[^\s\]<>"']+)\s*\]\s*<\/p>/gi, (_, caption, url) => figure(caption, url))
    .replace(MARKER, (_, caption, url) => figure(caption, url))
}
