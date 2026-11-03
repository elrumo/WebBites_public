# Security

## What is reachable from the internet

Only Caddy, on ports 80 and 443. Behind it, by path:

| Path | Goes to |
|---|---|
| `/v1/*`, `/mcp`, `/oauth/*`, `/.well-known/oauth-*`, `/extension-auth`, `/verify-extension-token`, `/health`, `/_docs/*`, and the upload and extension endpoints listed in `deploy/Caddyfile` | api |
| `/parse*` | Parse Server (REST, live updates, files) |
| `/s3/*` | RustFS, if enabled |
| everything else | web |

The API's internal routes (`/v1/jobs`, `/v1/triggers`, `/newUserFlow`, `/qstash-webhook`...) are not
forwarded, and refuse requests without the internal key anyway. MongoDB, Redis, Meilisearch and the
screenshot service publish no ports at all.

## The master key

`PARSE_MASTER_KEY` bypasses every permission. It is only honoured from private network ranges
(`PARSE_MASTER_KEY_IPS`), which includes the containers and excludes the internet (Caddy reports the real
client address, which Parse trusts one hop deep). Keep `.env` private (`chmod 600`, not in git).

## Claiming the install

The first account becomes administrator. Give the installer your email (`INITIAL_ADMIN_EMAIL`) so nobody
else can. After that, new people can sign up themselves: there is no invite-only mode yet. If the server
should not be open, put it behind a VPN or an authenticating proxy, or use Caddy's `basic_auth` for the whole site
(the extension and apps would need to cope with it).

## Telemetry

None by default. No analytics, no error reporting (`SENTRY_DSN` sends reports only to a Sentry you run),
Meilisearch analytics off, no fonts or scripts loaded from third parties. The AI endpoint and the screenshot
service only receive what you point them at; with no screenshot service, page addresses are not sent
anywhere beyond the sites themselves.

## Fetching pages

The server fetches the addresses users save. It refuses private and loopback addresses, including after
redirects. The screenshot service re-checks every request its browser makes and runs on its own network
with only the API.

## Updates

Pin `WEBBITES_VERSION`, subscribe to releases, and update. Report vulnerabilities as described in
[SECURITY.md](../SECURITY.md).
