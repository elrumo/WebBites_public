# API keys

Create, copy and revoke the keys on your account.

## Your keys

Create as many as you like — one per script, machine or environment keeps a leak small and makes the [usage breakdown](https://www.webbites.io/developers/docs/usage) readable. A new key works immediately.

On the live page this is an interactive panel (sign-in required, because keys belong to an account). It lists every key on your account and lets you name and create a new one, copy a key to the clipboard, and revoke a key — revoking pops a confirmation and there is no undo. Behind the panel these actions call the account key-management endpoints (`keys/list`, `keys/create`, `keys/revoke`); programmatically these map to the key management described in [Authentication](https://www.webbites.io/developers/docs/authentication).

## Using a key

Put it in the `Authorization` header of every request:

```bash
curl -i https://api.webbites.io/v1/api/usage \
  -H "Authorization: Bearer wb_live_…"
```

A `200` with a JSON body means the key is good. A `401` means the header never arrived or the key is no longer valid — see [Authentication](https://www.webbites.io/developers/docs/authentication).

## Revoking a key

The bin icon revokes a key on the spot; there is no undo and no grace period. Anything still using it starts getting `401`s with the next request, so rotate in this order:

1. Create the new key.
2. Deploy it wherever the old one lives.
3. Watch the usage breakdown until the old key stops counting.
4. Revoke the old key.

> We only ever show you a key on this page — treat the copy you save as the copy of record, and if you lose it, make a new one rather than hunting for it.
