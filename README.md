# WebBites

A bookmark manager that saves the page, reads it for you, searches inside it, and keeps it for good.
This repository is the open-source, self-hosted edition: the same app as [webbites.io](https://webbites.io),
without payment plans, running on your own server.

> **Status: early.** The self-hosted edition is new. Expect rough edges, and please open issues.

## Quick start

You need a Linux (or macOS) machine with Docker and Docker Compose v2, and, for HTTPS, a domain that
points at it.

```bash
git clone https://github.com/elrumo/webbites_public.git webbites && cd webbites/deploy
./install.sh            # asks a few questions, writes .env with fresh secrets
docker compose pull
docker compose up -d
```

Open the address the installer prints and create your account: the first account becomes the
administrator. Email, an AI endpoint, file storage and the rest are then set up from **/admin → Settings**,
no file editing needed.

Documentation is in [`docs/`](docs/): [quickstart](docs/quickstart.md),
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
deploy/          docker-compose.yml, Caddyfile, install.sh, .env.example
scripts/         repository checks
docs/            Documentation
```

## License

[AGPL-3.0-only](LICENSE). If you run a modified version as a network service, you must offer its source to
the people who use it.
