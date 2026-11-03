<template>
  <section>
    <h2 id="filters">Filters</h2>
    <p>
      <code>GET /bookmarks</code> returns your library newest first. Every filter is a query parameter,
      and they combine — <code>?q=rust&amp;tag=reading&amp;type=article</code> is an article, tagged
      reading, mentioning rust.
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Parameter</th><th>Does what</th><th>Example</th></tr></thead>
        <tbody>
          <tr v-for="row in FILTERS" :key="row.name">
            <td><code>{{ row.name }}</code></td>
            <td>{{ row.description }}</td>
            <td><code>{{ row.example }}</code></td>
          </tr>
        </tbody>
      </table>
    </div>
    <DevCode :tabs="FILTER_TABS" />
  </section>

  <section>
    <h2 id="full-text-search">Full-text search</h2>
    <p>
      <code>q</code> runs the same full-text search the app runs, over the text we hold for a bookmark
      rather than over the live page. A query that finds something in the app finds it here too.
    </p>
    <p>
      Search is a filter like any other, which means it pages the same way — don't assume the first
      response is all of it.
    </p>
  </section>

  <section>
    <h2 id="paging">Paging through everything</h2>
    <p>
      Paging is cursor based. Each response carries <code>nextBefore</code>: pass it back as
      <code>before</code> to get the page after it. When a response comes back with fewer rows than you
      asked for, or without a <code>nextBefore</code>, you have reached the end.
    </p>
    <DevCode :tabs="PAGE_TABS" />
    <div class="docs-note">
      The cursor is the <code>createdAt</code> of the last row, so a bookmark saved <em>while</em> you are
      paging appears at the front — in a page you have already passed — rather than duplicating itself
      further down.
    </div>
  </section>

  <section>
    <h2 id="types">Types</h2>
    <p>
      <code>type</code> is what kind of thing a bookmark is, decided when it is saved:
      <code>website</code>, <code>article</code>, <code>image</code>, <code>textNote</code> and the other
      kinds the app shows in its type filter. Filter on it when you want, say, only the long reads:
    </p>
    <DevCode :code="TYPE_EXAMPLE" language="bash" label="Request" />
  </section>
</template>

<script setup>
import { API_BASE_URL } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const FILTERS = [
  { name: 'q', description: 'Full-text search across your library.', example: 'q=postgres' },
  { name: 'tag', description: 'Only bookmarks carrying this tag.', example: 'tag=reading' },
  { name: 'type', description: 'Only this kind of bookmark.', example: 'type=article' },
  { name: 'limit', description: 'How many rows to return. Defaults to 50.', example: 'limit=100' },
  { name: 'before', description: 'A cursor from a previous response’s nextBefore.', example: 'before=2026-01-02T10:00:00.000Z' },
]

const FILTER_TABS = [
  {
    label: 'cURL',
    language: 'bash',
    code: `curl -G ${API_BASE_URL}/bookmarks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  --data-urlencode "q=rust" \\
  --data-urlencode "tag=reading" \\
  --data-urlencode "type=article" \\
  --data-urlencode "limit=20"`,
  },
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `const params = new URLSearchParams({ q: 'rust', tag: 'reading', type: 'article', limit: '20' })

const { bookmarks } = await fetch(\`${API_BASE_URL}/bookmarks?\${params}\`, {
  headers: { Authorization: \`Bearer \${process.env.WEBBITES_KEY}\` },
}).then(r => r.json())`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os, requests

res = requests.get(
    "${API_BASE_URL}/bookmarks",
    params={"q": "rust", "tag": "reading", "type": "article", "limit": 20},
    headers={"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"},
    timeout=30,
)
bookmarks = res.json()["bookmarks"]`,
  },
]

const PAGE_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `const headers = { Authorization: \`Bearer \${process.env.WEBBITES_KEY}\` }

async function* everything({ pageSize = 100, ...filters } = {}) {
  let before = null

  while (true) {
    const params = new URLSearchParams({ ...filters, limit: String(pageSize) })
    if (before) params.set('before', before)

    const page = await fetch(\`${API_BASE_URL}/bookmarks?\${params}\`, { headers })
      .then(r => r.json())

    for (const bookmark of page.bookmarks) yield bookmark

    // No cursor, or a short page: that was the last one.
    if (!page.nextBefore || page.bookmarks.length < pageSize) return
    before = page.nextBefore
  }
}

for await (const bookmark of everything({ tag: 'reading' })) {
  console.log(bookmark.createdAt, bookmark.title)
}`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os, requests

HEADERS = {"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"}


def everything(page_size=100, **filters):
    before = None

    while True:
        params = {**filters, "limit": page_size}
        if before:
            params["before"] = before

        page = requests.get(
            "${API_BASE_URL}/bookmarks", params=params, headers=HEADERS, timeout=30
        ).json()

        yield from page["bookmarks"]

        before = page.get("nextBefore")
        if not before or len(page["bookmarks"]) < page_size:
            return


for bookmark in everything(tag="reading"):
    print(bookmark["createdAt"], bookmark["title"])`,
  },
]

const TYPE_EXAMPLE = `curl -G ${API_BASE_URL}/bookmarks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  --data-urlencode "type=article" \\
  --data-urlencode "limit=10"`
</script>
