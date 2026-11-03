/**
 * Plain-Markdown copies of the /developers/docs pages, for LLMs and the docs'
 * "Copy page" button. Served at the same pretty URL with a `.md` suffix, e.g.
 * /developers/docs/quickstart.md (the introduction is index.md).
 *
 * This is a middleware, not a route, on purpose: Nitro's file router mishandles
 * a dynamic param next to a literal extension ([slug].md), and a catch-all route
 * would shadow the real docs pages. A middleware that only answers `*.md` and
 * otherwise returns lets every other request fall through to the Vue page.
 *
 * The Markdown source lives in server/assets/dev-docs/<slug>.md.
 */
export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  const match = path.match(/^\/developers\/docs\/([a-z0-9-]+)\.md$/)
  if (!match) return // not a docs .md request — let the page render

  const slug = match[1]
  const markdown = await useStorage('assets:server').getItem(`dev-docs/${slug}.md`)

  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  if (!markdown) {
    setResponseStatus(event, 404)
    return `# Not found\n\nNo docs page called "${slug}". See /developers/docs`
  }

  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  return markdown
})
