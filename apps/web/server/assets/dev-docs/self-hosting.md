# Self-hosting WebBites

Run the open-source edition on your own computer or server: what you need, the ways to install, your first account and what runs.

## What it is

WebBites is open source. The self-hosted edition is the same app as webbites.io, without payment plans, running on a server you control: your bookmarks, your database, your AI endpoint. No limits, every feature on, and nothing in it phones home.

- **One app or one command.** Web app, API, Parse Server, MongoDB, Redis, Meilisearch and Caddy, set up and started for you. Nothing to clone or build.
- **HTTPS included.** Caddy gets and renews the certificate for your domain by itself.
- **AGPL-3.0.** If you modify it and offer it to other people over a network, you offer them your modified source.

> The code and the issue tracker live at https://github.com/elrumo/webbites_public. The self-hosted edition is new, so expect rough edges and please open issues.

## What you need

- **Docker**: Docker Desktop on a Mac or Windows PC, or Docker Engine with Compose 2.23 or newer on Linux.
- **2 GB of free memory**, or about 3 GB with page previews (the screenshot service).
- To reach it from anywhere: a **domain name** pointing at the machine, with ports 80 and 443 open. To use it on one computer, nothing.

## Install

Pick the way that suits where WebBites will run. They all set up the same thing.

- **On your Mac, PC or Linux desktop:** download the WebBites Server app. It checks Docker, asks two questions in your browser, installs, and then starts, stops and updates WebBites from the menu bar. No terminal. See [The WebBites Server app](https://www.webbites.io/developers/docs/self-hosting-app).
- **On a server, with one command:** `curl -fsSL https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh | sh` downloads the latest release, asks for your domain and starts WebBites with HTTPS. See [Install from the terminal](https://www.webbites.io/developers/docs/self-hosting-terminal#one-command).
- **By hand, with compose.yaml:** one compose file and an `.env` you write yourself. See [By hand with compose.yaml](https://www.webbites.io/developers/docs/self-hosting-terminal#by-hand).
- **With the `webbites-server` command:** the app's command-line side, for servers: `install`, `status`, `update`, `logs`. See [The webbites-server command](https://www.webbites.io/developers/docs/self-hosting-terminal#cli).

![WebBites Server asking where you will use WebBites: on this Mac, or on a server at your own address](https://www.webbites.io/self-hosting/app/where.webp)

The images are published on Docker Hub as `elrumo/webbites-web`, `elrumo/webbites-api`, `elrumo/webbites-parse` and `elrumo/webbites-screenshot`, for both `amd64` and `arm64`, and every way above uses them: nothing is built on your machine.

## Claim the install

Open your WebBites (the address the installer shows) and create your account straight away: the first account becomes the administrator. With `INITIAL_ADMIN_EMAIL` set, only that address can claim it, so a stranger who finds the server first cannot. Leave it empty and whoever signs up first wins, so do not leave a fresh install unattended on the internet.

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
| `screenshot` | The headless browser that screenshots pages and renders JavaScript. Optional (page previews): leave it out to save about 1 GB of RAM. |
| `rustfs` | Optional (separate file storage): an S3-compatible store for uploads, instead of MongoDB. |

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

Next: install with [the WebBites Server app](https://www.webbites.io/developers/docs/self-hosting-app) or [from the terminal](https://www.webbites.io/developers/docs/self-hosting-terminal), then read [configuration, backups and upgrades](https://www.webbites.io/developers/docs/self-hosting-operations).
