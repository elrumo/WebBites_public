# Authentication

API keys, the Authorization header and how to keep a key safe.

## The header

Every request carries your key as a bearer token. There is no other authentication scheme, no session to establish and no refresh to handle.

**Header**
```bash
Authorization: Bearer wb_live_…
```

Keys start with `wb_live_`. Requests to the API without the header, or with a key that has been revoked, come back `401`.

## Where keys come from

Create them on the [API keys](https://www.webbites.io/developers/docs/api-keys) page, or in the app under Settings → Developer. An account can hold several: one per script, per machine or per environment makes a leak cheap to contain, and the [usage breakdown](https://www.webbites.io/developers/docs/usage) tells you which key spent what.

## Keeping a key safe

A key is your whole library: it can read every bookmark and save new ones. Treat it like a password.

- Keep it on a server, in a secrets manager, or in an environment variable — never in a repository.
- Don't ship it inside a browser app, a mobile binary or a browser extension. Anything a user can install, a user can read.
- If a key has to reach the browser, put your own backend in front of the API and keep the key on it.
- Rotate on a schedule: create the replacement, deploy it, then revoke the old one. Nothing breaks in between.

> ⚠️ The [playground](https://www.webbites.io/developers/docs/playground) is the one place a key goes into a browser — your own, in your own tab. It is never sent to this website's server or stored.

## Revoking

Revoking is immediate and cannot be undone — the next request made with that key gets a `401`. If you think a key has leaked, revoke first and work out the blast radius afterwards.
