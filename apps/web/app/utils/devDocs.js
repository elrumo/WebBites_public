/**
 * The docs sidebar. One entry per page under /developers/docs, grouped the way
 * the sidebar renders them. `keywords` only feeds the sidebar's filter box.
 *
 * `slug: ''` is the index — /developers/docs itself.
 */
export const DOC_GROUPS = [
  {
    title: 'Getting started',
    icon: 'i-heroicons-sparkles',
    items: [
      { slug: '', title: 'Introduction', description: 'What the WebBites API does, and what it does not.', keywords: 'overview intro about' },
      { slug: 'quickstart', title: 'Quickstart', description: 'From nothing to your first saved bookmark in about two minutes.', keywords: 'start first call curl hello world' },
      { slug: 'authentication', title: 'Authentication', description: 'API keys, the Authorization header and how to keep a key safe.', keywords: 'api key bearer token secret auth' },
    ],
  },
  {
    title: 'Guides',
    icon: 'i-heroicons-book-open',
    items: [
      { slug: 'saving-bookmarks', title: 'Saving bookmarks', description: 'What happens after POST /bookmarks, and how to wait for the enriched version.', keywords: 'create post save url screenshot summary tags' },
      { slug: 'searching', title: 'Searching & paging', description: 'Filter by text, tag and type, then walk the whole library with a cursor.', keywords: 'list query q tag type limit before cursor pagination' },
      { slug: 'webhooks', title: 'Webhooks', description: 'Get a POST the moment a bookmark finishes processing — and verify it is us.', keywords: 'webhook event signature hmac delivery retry' },
      { slug: 'errors', title: 'Errors & retries', description: 'The status codes you will meet and what to do about each one.', keywords: 'error status code 400 401 429 retry backoff' },
      { slug: 'rate-limits', title: 'Rate limits', description: 'Per-minute and per-month allowances, and the headers that track them.', keywords: 'limit quota 429 throttle plan' },
      { slug: 'recipes', title: 'Recipes', description: 'Six small programs you can copy, in JavaScript or Python: a Slack command, a digest, a reading list, a star mirror, a notes sync, a backup.', keywords: 'examples recipes slack digest backup export script reading list notes obsidian python javascript' },
      { slug: 'mcp', title: 'MCP server (AI assistants)', description: 'Connect Claude, ChatGPT, Cursor and other AI assistants to your library: setup, sign-in, the tools and the limits.', keywords: 'mcp model context protocol ai assistant agent claude chatgpt cursor vscode copilot connector oauth tools llm local mac' },
    ],
  },
  {
    title: 'Your account',
    icon: 'i-heroicons-key',
    items: [
      { slug: 'api-keys', title: 'API keys', description: 'Create, copy and revoke the keys on your account.', keywords: 'keys create revoke manage' },
      { slug: 'usage', title: 'Usage', description: 'What you have spent this month, per key.', keywords: 'usage quota billing plan month' },
      { slug: 'playground', title: 'Playground', description: 'Fire a real request at the API from this page and read the response.', keywords: 'playground try it console test request' },
    ],
  },
  {
    title: 'Reference',
    icon: 'i-heroicons-command-line',
    items: [
      { slug: 'endpoints', title: 'Endpoints', description: 'Every endpoint, its parameters, a curl and a sample response.', keywords: 'reference endpoints routes list all' },
      { slug: 'bookmark-object', title: 'The bookmark object', description: 'Every field a bookmark comes back with.', keywords: 'schema fields object model bookmark' },
    ],
  },
]

/** Flat, in sidebar order — drives prev/next and slug lookup. */
export const DOC_PAGES = DOC_GROUPS.flatMap(group =>
  group.items.map(item => ({ ...item, group: group.title }))
)

export const docPath = (slug) => (slug ? `/developers/docs/${slug}` : '/developers/docs')

export const findDoc = (slug) => DOC_PAGES.find(p => p.slug === (slug || '')) || null

export const docNeighbours = (slug) => {
  const index = DOC_PAGES.findIndex(p => p.slug === (slug || ''))
  return {
    previous: index > 0 ? DOC_PAGES[index - 1] : null,
    next: index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : null,
  }
}
