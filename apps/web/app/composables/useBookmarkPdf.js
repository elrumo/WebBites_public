import { resolveFileUrl } from '~/composables/useBookmarkImages'

/**
 * Reading a PDF bookmark.
 *
 * A PDF row keeps our stored copy of the document in `file` (with `fileUrl`
 * alongside it, for the readers that only ever see the plain search document
 * and never a Parse.File), and the link it was saved from in `url`. Those are
 * not interchangeable: `url` is what "open original" should go to and what a
 * re-save de-duplicates against, while the viewer has to read our copy, because
 * the original may sit behind a paywall, a signed link that has since expired,
 * or nothing at all when the PDF was uploaded rather than linked.
 */

export function isPdfBookmark(site) {
  return Boolean(site) && site.type === 'pdf'
}

/** Our stored copy of the document — what the viewer loads. */
export function pdfFileUrl(site) {
  if (!site) return null
  return site.fileUrl || resolveFileUrl(site.file) || null
}

/**
 * `12 pages`, or nothing when the document could not be read — a scan behind
 * an encrypted wrapper, or a file that arrived truncated.
 */
export function pdfPageLabel(site, t) {
  const pages = Number(site?.pageCount)
  if (!Number.isFinite(pages) || pages <= 0) return ''

  const translate = typeof t === 'function' ? t : useNuxtApp().$i18n.t
  return pages === 1
    ? translate('bookmarks.pdf_page_one')
    : translate('bookmarks.pdf_page_count', { n: pages })
}
