# Architecture

```
browser ──► caddy ──┬─► web  (Nuxt: pages, a thin server layer)
                    ├─► api  (Nitro on Bun: bookmarks, search, jobs, public API, MCP)
                    └─► parse (Parse Server: accounts, data, live queries, files)
                 web ─► api, parse        (inside the network, by service name)
                 api ─► parse, redis, meilisearch, screenshot, S3
                parse ─► mongo, api       (cloud code calls the API's job endpoint)
```

- **Parse Server on MongoDB** stores accounts and data. The browser talks to it directly for most reads
  and writes, under Parse's per-user permissions; the API uses the master key for the rest.
- **The API** does the heavy work: fetching and extracting pages, AI calls, search indexing, imports,
  RSS, audio. Work is queued in Redis (BullMQ) and run by workers inside the API process.
- **Search** is Meilisearch, kept in step by the API. Embeddings are optional (need an AI endpoint).
- **Screenshots** come from the optional Playwright service, called by the API. Without it cards use the
  page's own image.
- **Settings** entered on the admin page live in Parse (`AppSettings`, secrets encrypted). The API reads
  them continuously, Parse reads them when it starts.
- **Billing** is a provider interface in the API. This repository ships the `none` provider: everyone
  is unlimited. The hosted service plugs Stripe in from a separate private repository; see
  [FAQ](faq.md).

Source layout: `apps/web`, `apps/api`, `apps/parse`, `apps/screenshot`, `deploy/`.
