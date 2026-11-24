# Configuration, backups & upgrades

Configure, back up, restore and upgrade a self-hosted WebBites, plus security notes and moving from webbites.io.

## Configuration

Settings come from three places, strongest first:

1. **The environment**: the variables in `compose.yaml`, most of which read their value from `.env`. A setting defined here is locked on the admin page as "Set by the environment".
2. **The admin page** (`/admin → Settings`), stored in MongoDB. Secrets are encrypted with `SETTINGS_ENCRYPTION_KEY`.
3. **Built-in defaults.**

An empty variable counts as not set, so `FOO=` in `.env` locks nothing.

### What the admin page can change

| Group | Covers |
|---|---|
| Email | SMTP or Mailgun, and the sender address |
| AI endpoint | Any OpenAI-style endpoint (or a local model), and the text, multimodal and embedding models |
| File storage | MongoDB, or any S3-compatible bucket |
| Search | Meilisearch host and key |
| Screenshots | The screenshot service address and key |
| Name and contact | App name and support email |

After saving, the page shows a Restart button where a service needs one. Docker starts it again; no Docker socket is mounted anywhere.

### What stays in .env

Things the services need before the page can load, or that must not be editable from a browser: the public address (`PUBLIC_URL`), `WEBBITES_VERSION`, `INITIAL_ADMIN_EMAIL` and the generated secrets (Parse keys, `MONGO_PASSWORD`, `SETTINGS_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY` and so on).

A few optional integrations have no admin field: `TMDB_API_KEY` (movies), `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (games) and `SENTRY_DSN`. Add them to `.env` and to the `environment:` of the services that use them in `compose.yaml`: `web` and `api` for the first three, `api` and `parse` for Sentry.

Losing `SETTINGS_ENCRYPTION_KEY` or `BACKUP_ENCRYPTION_KEY` makes what they protect unreadable. Back up `.env`, keep it private (`chmod 600`) and out of git.

## Upgrading

Images are tagged with the release version, and `WEBBITES_VERSION` in `.env` picks one (default `latest`).

```bash
cd webbites
curl -fsSLO https://www.webbites.io/self-hosting/compose.yaml   # the release may have changed it
docker compose pull
docker compose up -d
```

If you edited `compose.yaml` (a trusted proxy, no screenshot service), see what changed before replacing it: `curl -fsSL https://www.webbites.io/self-hosting/compose.yaml | diff compose.yaml -`. Installed from the GitHub repository instead? Run `git pull` in `deploy/` in place of the download.

Compose recreates only containers whose image changed, and Parse and the API run any data upgrades they need when they start.

- **Pin versions.** Set `WEBBITES_VERSION=1.2.3` so a restart never pulls something new by surprise, and bump it deliberately.
- **Back up first**, especially across a major version.
- **Roll back** by setting the previous version and running `docker compose up -d`. If the new version changed the data format, restore your backup.

## Backups and restore

| Holds | If lost |
|---|---|
| `mongo_data`: accounts, bookmarks, boards, notes, settings, and files unless you use S3 | Everything is gone |
| `redis_data`: developer API keys, queued jobs | API keys stop working; users create new ones |
| Your S3 bucket, if you chose one: files | Images and attachments are gone |
| `meili_data`: the search index | Nothing: rebuild it from Admin → Search index → Sync now |
| `.env`: every secret | Encrypted settings and backups cannot be read |

The three that matter, while the stack runs:

```bash
cd webbites
set -a; . ./.env; set +a
STAMP=$(date +%F)

# MongoDB (a consistent dump)
docker compose exec -T mongo mongodump -u webbites -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --archive --gzip > "mongo-$STAMP.archive.gz"

# Redis: save, then copy the append-only file out
docker compose exec -T redis redis-cli SAVE
docker run --rm -v webbites_redis_data:/data -v "$PWD":/out alpine tar czf "/out/redis-$STAMP.tgz" -C /data .

# The secrets
cp .env "env-$STAMP.backup" && chmod 600 "env-$STAMP.backup"
```

Restore on a fresh install (or after deleting the volumes), with the original `.env` in place:

```bash
docker compose up -d mongo redis
docker compose exec -T mongo mongorestore -u webbites -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --archive --gzip --drop < mongo-2025-01-01.archive.gz

docker compose stop redis
docker run --rm -v webbites_redis_data:/data -v "$PWD":/in alpine sh -c 'rm -rf /data/* && tar xzf /in/redis-2025-01-01.tgz -C /data'
docker compose up -d

# then open Admin → Search index → Sync now to rebuild search
```

Keep backups somewhere that is not this machine, encrypted: they contain everything, including your users' data. Test a restore once, on a spare machine, before you need it.

## Security

- **One door.** Only Caddy is reachable, on ports 80 and 443. The API's internal routes are not forwarded and refuse requests without the internal key anyway.
- **The master key.** `PARSE_MASTER_KEY` bypasses every permission. It is only honoured from private network ranges, which includes the containers and excludes the internet.
- **No telemetry.** No analytics and no error reporting by default; `SENTRY_DSN` sends reports only to a Sentry you run. Nothing contacts webbites.io.
- **Fetching pages.** The server refuses private and loopback addresses, including after redirects, and the screenshot browser runs on its own network.
- **Behind another proxy** (Cloudflare, a load balancer)? Tell Caddy to trust it in the Caddyfile at the bottom of `compose.yaml`, or rate limits see the wrong address.

Report vulnerabilities as described in [SECURITY.md](https://github.com/elrumo/webbites_public/blob/main/SECURITY.md).

## Moving from webbites.io

1. In the hosted app, go to Settings → Backups and back up now (or download a backup). The zip holds `bookmarks.html`: every live bookmark in the standard browser format.
2. On your install, click Import and choose `bookmarks.html`. Each address is fetched and processed again, so titles, summaries, screenshots and search are rebuilt by your server. A large library takes a while, and a lot of AI calls if you configured an endpoint.

Boards, tags and notes are in the backup's JSON files but have no importer yet, and accounts, passwords, developer keys and MCP connections have to be created again.
