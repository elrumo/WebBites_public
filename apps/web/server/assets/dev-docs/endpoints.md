# Endpoints

Every endpoint, its parameters, a curl and a sample response.

Every endpoint, with its parameters, a request you can paste into a terminal and a sample response. All paths are relative to `https://api.webbites.io/v1/api`, all requests carry `Authorization: Bearer …`, and everything is JSON in and JSON out.

**Bookmarks** — Read and write the library itself.

## GET /bookmarks

List your bookmarks, newest first. Page with `nextBefore`.

| Name | In | Required | Description |
| --- | --- | --- | --- |
| `limit` | query | No | max rows (default 50) |
| `before` | query | No | cursor from a previous nextBefore |
| `tag` | query | No | only bookmarks with this tag |
| `type` | query | No | website, article, image, textNote… |
| `q` | query | No | full-text search |

**Response**
```json
{
  "bookmarks": [
    { "id": "abc123", "url": "https://example.com", "title": "Example", "type": "website", "tags": ["docs"], "createdAt": "2026-01-02T10:00:00.000Z" }
  ],
  "nextBefore": "2026-01-02T10:00:00.000Z"
}
```

## GET /bookmarks/:id

One bookmark with its summary, tags, note, screenshot and metadata.

| Name | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | Yes | bookmark id |

**Response**
```json
{ "id": "abc123", "url": "https://example.com", "title": "Example", "description": "…", "type": "website", "tags": ["docs"], "note": "", "summary": "…", "image": "https://…", "screenshot": "https://…", "favicon": "https://…", "createdAt": "…" }
```

## POST /bookmarks

Save a URL. Screenshot, summary and auto-tags are generated in the background; a webhook fires when it is done.

| Name | In | Required | Description |
| --- | --- | --- | --- |
| `url` | body | Yes | the page to save |
| `tags` | body | No | comma separated |
| `note` | body | No | free-text note |

**Response**
```json
{ "id": "abc123", "url": "https://example.com", "status": "processing" }
```

**Account** — What your plan allows and what you have spent.

## GET /usage

Your plan, its limits and what you have used this month, per key.

No parameters.

**Response**
```json
{ "tier": "plus", "limits": { "perMinute": 300, "perMonth": 20000 }, "usage": { "month": 412, "total": 9031, "byKey": { "wb_live_…": 412 } } }
```

**Webhooks** — Register the endpoints we push finished bookmarks to.

## GET /webhooks

Your webhooks and the events they can subscribe to.

No parameters.

**Response**
```json
{ "webhooks": [ { "id": "wh_1", "url": "https://example.com/hook", "events": ["bookmark.saved"], "description": "", "active": true, "failureCount": 0, "lastStatus": 200, "lastDeliveredAt": "…", "secret": "whsec_…" } ], "events": ["bookmark.saved"] }
```

## POST /webhooks

Register a webhook. The response includes the signing secret.

| Name | In | Required | Description |
| --- | --- | --- | --- |
| `url` | body | Yes | https endpoint to POST to |
| `events` | body | No | comma separated, default bookmark.saved |
| `description` | body | No | a label for you |

**Response**
```json
{ "id": "wh_1", "url": "https://example.com/hook", "events": ["bookmark.saved"], "active": true, "secret": "whsec_…" }
```

## DELETE /webhooks/:id

Remove a webhook.

| Name | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | Yes | webhook id |

**Response**
```json
{ "ok": true }
```

## POST /webhooks/:id/test

Send a sample delivery and report the status your endpoint answered with.

| Name | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | Yes | webhook id |

**Response**
```json
{ "ok": true, "status": 200 }
```

## The generated reference

This page is the hand-written version. The [OpenAPI document](https://api.webbites.io/_docs/scalar) is generated from the server itself — point your client generator at it, or read it when you want the exact schema of a field rather than an example of it.
