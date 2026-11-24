# Self-hosting WebBites

Run the open-source edition on your own server with Docker Compose: requirements, install, first account and what runs.

## What it is

WebBites is open source. The self-hosted edition is the same app as webbites.io, without payment plans, running on a server you control: your bookmarks, your database, your AI endpoint. No limits, every feature on, and nothing in it phones home.

- **One compose file.** Web app, API, Parse Server, MongoDB, Redis, Meilisearch and Caddy, started with one command. Nothing to clone or build.
- **HTTPS included.** Caddy gets and renews the certificate for your domain by itself.
- **AGPL-3.0.** If you modify it and offer it to other people over a network, you offer them your modified source.

> The code and the issue tracker live at https://github.com/elrumo/webbites_public. The self-hosted edition is new, so expect rough edges and please open issues.

## What you need

- A Linux or macOS machine with Docker and Docker Compose 2.23 or newer.
- 2 GB of RAM, or about 3 GB if you also run the screenshot service.
- For a public install, a domain name pointing at the machine, with ports 80 and 443 open.

## Install

Make a folder, download `compose.yaml` into it and write a `.env` next to it with your address and fresh secrets. Change `PUBLIC_URL` to your domain first, or use `http://localhost` to try it on one machine.

```bash
mkdir webbites && cd webbites
curl -fsSLO https://www.webbites.io/self-hosting/compose.yaml

# Your address and fresh secrets
cat > .env <<EOF
PUBLIC_URL=https://notes.example.com
INITIAL_ADMIN_EMAIL=you@example.com
MONGO_PASSWORD=$(openssl rand -hex 24)
PARSE_APP_ID=$(openssl rand -hex 8)
PARSE_JS_KEY=$(openssl rand -hex 24)
PARSE_MASTER_KEY=$(openssl rand -hex 32)
CUSTOM_API_KEY=$(openssl rand -hex 32)
AUDIO_TOKEN_SECRET=$(openssl rand -hex 32)
SHARE_LINK_SECRET=$(openssl rand -hex 32)
BACKUP_ENCRYPTION_KEY=$(openssl rand -hex 32)
SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 32)
MEILI_MASTER_KEY=$(openssl rand -hex 24)
SCREENSHOT_API_KEY=$(openssl rand -hex 24)
EOF
chmod 600 .env

docker compose up -d
```

That is the whole install. `compose.yaml` is the setup, the same for everyone: read it at https://www.webbites.io/self-hosting/compose.yaml. `.env` holds what is yours: the address and the secrets. Keep it private and back it up; upgrading replaces `compose.yaml` and never touches it. Email, AI, file storage and the rest are set from the admin page, so they are not in the file.

The images are published on Docker Hub as `elrumo/webbites-web`, `elrumo/webbites-api`, `elrumo/webbites-parse` and `elrumo/webbites-screenshot`, for both `amd64` and `arm64`.

## Claim the install

Open your `PUBLIC_URL` and create your account straight away: the first account becomes the administrator. With `INITIAL_ADMIN_EMAIL` set, only that address can claim it, so a stranger who finds the server first cannot. Leave it empty and whoever signs up first wins, so do not leave a fresh install unattended on the internet.

Then, as administrator, open /admin → Settings to connect email, an AI endpoint, file storage and the rest. No file editing needed.

Anyone who can reach the server can sign up; there is no invite-only mode yet. If the server should stay private, put it behind a VPN or an authenticating proxy.

## What runs

| Container | Role |
|---|---|
| `caddy` | The only thing that listens on ports 80 and 443. Gets the HTTPS certificate. |
| `web` | The Nuxt web app. |
| `api` | The backend: bookmarks, search, background jobs, the public API and the MCP server. |
| `parse` | Parse Server: accounts, data, live updates and file serving. |
| `mongo` | The database, and file storage unless you choose S3. |
| `redis` | Job queue, rate limits and developer API keys. Persisted: it is not just a cache. |
| `meilisearch` | Search. |
| `screenshot` | The headless browser that screenshots pages and renders JavaScript. Optional: delete it from `compose.yaml` to save about 1 GB of RAM. |

Only Caddy listens on the network. MongoDB, Redis, Meilisearch and the screenshot service publish no ports at all.

## Using the API on your server

The API and MCP server run on your own domain, so everything in these docs works against it. Replace `https://api.webbites.io/v1/api` with your address. Create a developer key in the app on the Developers page, then:

```bash
curl https://your.domain/v1/api/bookmarks?limit=5 \
  -H "Authorization: Bearer wb_live_…"
```

- OpenAPI reference: `https://your.domain/_docs/scalar`
- MCP server for AI assistants: `https://your.domain/mcp`

Self-hosted installs have no plans, so the [rate limits](https://www.webbites.io/developers/docs/rate-limits) are the hosted service's and do not apply.

## What is different, and what is missing

- There is no marketing site: `/` goes to sign-in.
- Email, AI, screenshots and search run on services you provide, all set from the admin page.
- The browser extension and the iOS and macOS apps are built against webbites.io and have no server-address setting yet. Use the web app (it installs as a PWA), the API or MCP.
- Not built yet: invite-only sign-ups, an importer for boards and tags from a webbites.io backup, and running more than one Parse instance.

Next: [configuration, backups and upgrades](https://www.webbites.io/developers/docs/self-hosting-operations).
