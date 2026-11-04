# The bookmark object

Every field a bookmark comes back with.

## Fields

The shape you get from `GET /bookmarks/:id`, from each row of `GET /bookmarks`, and inside every webhook delivery. Listing endpoints return the smaller fields; the single-bookmark endpoint returns the lot.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Stable id. Use it with GET /bookmarks/:id. |
| `url` | `string` | The page you saved. |
| `title` | `string` | Page title, or the one you edited in the app. |
| `description` | `string` | Meta description pulled from the page. |
| `type` | `string` | website, article, image, textNote and friends. |
| `tags` | `string[]` | Yours plus the ones generated for you. |
| `note` | `string` | Your own note on the bookmark. |
| `summary` | `string` | Generated summary of the page. Empty while it is still processing. |
| `image` | `string` | Preview image URL. |
| `screenshot` | `string` | Full page screenshot URL. |
| `favicon` | `string` | Site icon URL. |
| `createdAt` | `string` | ISO 8601 timestamp. Also the pagination cursor. |

## An example

**bookmark**
```json
{
  "id": "abc123",
  "url": "https://example.com/an-article",
  "title": "An article",
  "description": "What the page says it is about.",
  "type": "article",
  "tags": ["reading", "research"],
  "note": "Cited in the Q3 deck",
  "summary": "A few sentences describing the page.",
  "image": "https://…/preview.jpg",
  "screenshot": "https://…/screenshot.jpg",
  "favicon": "https://…/favicon.ico",
  "createdAt": "2026-01-02T10:00:00.000Z"
}
```

> A freshly created bookmark has most of this empty and `"status": "processing"` instead — see [Saving bookmarks](https://www.webbites.io/developers/docs/saving-bookmarks).

## Types

`type` says what kind of thing was saved, and it is what the app's type filter runs on. You will meet `website`, `article`, `image` and `textNote` most often; filter on whichever one you care about with `?type=`.

## What you can write

Through the API you set `url`, `tags` and `note` when you create a bookmark. Everything else is derived from the page — edit those in the app, and the API returns your edited version from then on.
