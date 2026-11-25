# WebBites

A bookmark manager that saves the page, reads it for you, searches inside it, and keeps it for good.
This repository is the open-source, self-hosted edition: the same app as [webbites.io](https://webbites.io),
without payment plans, running on your own server.

> **Status: early.** The self-hosted edition is new. Expect rough edges, and please open issues.

## Quick start

You need Docker with Docker Compose v2 and, for HTTPS, a domain that points at the machine.

**On a server**, one command (it downloads only the deployment files, not this repository):

```bash
curl -fsSL https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh | sh
```

**On your Mac or PC**, download the **WebBites Server** app from the
[latest release](https://github.com/elrumo/webbites_public/releases/latest): it sets WebBites up from
a page in your browser, then starts, stops and updates it from the menu bar. See [the app](docs/desktop-app.md).

**From a clone:**

```bash
git clone https://github.com/elrumo/webbites_public.git webbites && cd webbites/deploy
./install.sh            # asks a few questions, writes .env with fresh secrets
docker compose pull
docker compose up -d
```

Open the address the installer prints and create your account: the first account becomes the
administrator. Email, an AI endpoint, file storage and the rest are then set up from **/admin → Settings**,
no file editing needed.

Documentation is in [`docs/`](docs/): [quickstart](docs/quickstart.md), [desktop app](docs/desktop-app.md),
[configuration](docs/configuration.md), [backups](docs/backups.md), [upgrading](docs/upgrade.md),
[security](docs/security.md), [FAQ](docs/faq.md).

## What runs

| Service | Image | Purpose |
|---|---|---|
| `web` | `elrumo/webbites-web` | The Nuxt web app |
| `api` | `elrumo/webbites-api` | The backend API and background job workers |
| `parse` | `elrumo/webbites-parse` | Parse Server (accounts, data, live updates) |
| `screenshot` | `elrumo/webbites-screenshot` | Page screenshots and JavaScript rendering (optional) |
| `mongo`, `redis`, `meilisearch` | official images | Database, queues/keys, search |
| `caddy` | official image | HTTPS and routing on one domain |
| `rustfs` | official image | S3-compatible file storage (optional; files are stored in MongoDB by default) |

## Repository layout

```
apps/web         Nuxt web app
apps/api         Nitro/Bun API
apps/parse       Parse Server and cloud code
apps/screenshot  Screenshot service
apps/installer   WebBites Server, the desktop/CLI installer (Go)
deploy/          docker-compose.yml, Caddyfile, install.sh, get.sh (one-line installer), .env.example
scripts/         repository checks
docs/            Documentation
```

## License

[AGPL-3.0-only](LICENSE). If you run a modified version as a network service, you must offer its source to
the people who use it.
