# Introduction

What the WebBites API does, and what it does not.

## What this API is

A small REST API over your WebBites library. You authenticate with an API key, send JSON, and get JSON back. There is no SDK to install and nothing to configure — if your language can make an HTTP request, it can talk to WebBites.

Everything you reach through it belongs to the account the key was made on: your bookmarks, your tags, your usage, your webhooks. There is no way to read anybody else's library with it.

> Base URL — every path on this site is relative to it: `https://api.webbites.io/v1/api`

## What you can do with it

- **Save anything** — POST a URL and it lands in your library, enriched the same way a save from the app is.
- **Read your library** — List, filter and full-text search your bookmarks, then page through the lot with a cursor.
- **React to saves** — Register a webhook and get a signed POST the moment a bookmark finishes processing.
- **Watch your quota** — GET /usage returns your plan, its limits and what you have spent this month, per key.

## How a save works

Saving is asynchronous, and that shapes most of the code you will write against this API. `POST /bookmarks` answers immediately with `"status": "processing"`, then the screenshot, the summary and the automatic tags are generated in the background. A minute later the same bookmark comes back with all of it filled in.

1. **You post a URL.** The response carries the new bookmark's `id` straight away.
2. **We fetch and enrich the page.** Screenshot, description, summary, tags, favicon.
3. **You find out it is done** — through a [webhook](https://www.webbites.io/developers/docs/webhooks), or by re-reading `GET /bookmarks/:id`.

The [Saving bookmarks](https://www.webbites.io/developers/docs/saving-bookmarks) guide has the code for both routes.

## Where to start

- [Quickstart](https://www.webbites.io/developers/docs/quickstart) — A key, a curl, a saved bookmark. About two minutes.
- [Endpoints](https://www.webbites.io/developers/docs/endpoints) — Every route with its parameters and a sample response.
- [Playground](https://www.webbites.io/developers/docs/playground) — Fire a real request without leaving the page.
- [Recipes](https://www.webbites.io/developers/docs/recipes) — Copy-paste programs: a backup, a Slack command, a digest.

The generated [OpenAPI reference](https://api.webbites.io/_docs/scalar) is the machine-readable source of truth, and stays in step with the server.
