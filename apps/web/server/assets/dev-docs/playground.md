# Playground

Fire a real request at the API from this page and read the response.

## Try a request

Pick an endpoint, pick a key, fill in what it needs and send it. This is the real API against your real library — a `POST /bookmarks` here saves a bookmark for real.

On the live page this is an interactive request console. You choose one of the documented endpoints, pick one of your keys from the dropdown (when signed in) or paste any `wb_live_` key, fill in the endpoint's query parameters or JSON body, and press Send. The request goes straight from your browser to the API base URL `https://api.webbites.io/v1/api` with your key in the `Authorization: Bearer` header — nothing is proxied through the website and nothing is stored. It calls whichever endpoint you selected (for example `GET /bookmarks`, `POST /bookmarks` or `GET /usage`) and shows the response status, the round-trip time in milliseconds, the rate-limit headers that came back, and the response body.

## What it is doing

The request goes straight from your browser to `https://api.webbites.io/v1/api` with the key you chose in the `Authorization` header — the same request the curl samples make. Nothing is proxied through this website and nothing is stored: reload the page and the key is gone.

The badges above the response are the [rate limit headers](https://www.webbites.io/developers/docs/rate-limits) that came back with it, so you can watch your remaining allowance tick down as you experiment.

> Signed in? Your keys appear in the dropdown. Otherwise paste one — a key from any account works here, because the API only ever cares about the key.

## When it fails

- **0 Network error** — the request never reached the API. Usually an extension or a network blocking the call, rather than anything wrong with the request itself.
- **401** — the key is wrong, revoked, or was pasted with whitespace around it.
- **429** — you are over a limit. The badges say which, and [usage](https://www.webbites.io/developers/docs/usage) says how much is left.
- **Anything else** — the body is shown verbatim; [Errors](https://www.webbites.io/developers/docs/errors) covers what each status means.
