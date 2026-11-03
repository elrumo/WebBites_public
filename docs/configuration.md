# Configuration

Settings come from three places, strongest first:

1. **The environment** (`deploy/.env`, passed to the containers by `docker-compose.yml`). A setting
   defined here is *locked* on the admin page ("Set by the environment").
2. **The admin page** (/admin → Settings), stored in MongoDB. Secrets are encrypted with
   `SETTINGS_ENCRYPTION_KEY`.
3. **Built-in defaults.**

An empty variable counts as not set, so `FOO=` in `.env` does not lock anything.

## What the admin page can change

| Group | Variables | Takes effect |
|---|---|---|
| Email | `MAIL_PROVIDER`, `MAIL_FROM`, `SMTP_HOST/PORT/USER/PASS/SECURE`, `MAILGUN_API_KEY/DOMAIN/API_URL` | API at once; Parse after its restart |
| AI endpoint | `AI_API_BASE_URL`, `AI_API_KEY`, `AI_API_STYLE`, `AI_TEXT_MODEL`, `AI_MULTIMODAL_MODEL`, `EMBEDDING_MODEL` | at once |
| File storage | `FILES_DRIVER`, `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` | API at once; Parse after its restart |
| Search | `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` | after the API restarts |
| Screenshots | `SCREENSHOT_SERVICE_URL`, `SCREENSHOT_API_KEY` | at once |
| Name and contact | `APP_NAME`, `SUPPORT_EMAIL` | API at once; Parse after its restart |

"Restart" means the **Restart** button the page shows after saving. It makes the service exit; Docker
(`restart: unless-stopped`) starts it again. No Docker socket is mounted anywhere. If Parse cannot
start with the saved values it starts with the previous working ones and the page says so.

## What stays in `.env`

Things the services need before the page can load, or that must not be editable from a browser.

| Variable | Used by | |
|---|---|---|
| `PUBLIC_URL`, `SITE_ADDRESS`, `HTTP_PORT`, `HTTPS_PORT`, `ACME_EMAIL` | compose, Caddy | The address people use |
| `WEBBITES_VERSION` | compose | Which image tag runs |
| `COMPOSE_PROFILES` | compose | `screenshots`, `rustfs` |
| `INITIAL_ADMIN_EMAIL` | parse | Only this address may claim the administrator account |
| `MONGO_PASSWORD` | mongo, parse | |
| `PARSE_APP_ID`, `PARSE_JS_KEY`, `PARSE_MASTER_KEY` | web, api, parse | Parse's keys. The master key is full access: keep it private |
| `CUSTOM_API_KEY` | web, api, parse | Shared secret for calls between the services |
| `AUDIO_TOKEN_SECRET`, `SHARE_LINK_SECRET` | api | Sign audio-stream and share links |
| `BACKUP_ENCRYPTION_KEY` | api | Encrypts users' stored backup destinations |
| `SETTINGS_ENCRYPTION_KEY` | api, parse | Encrypts secrets saved on the admin page |
| `MEILI_MASTER_KEY` | meilisearch, api | |
| `SCREENSHOT_API_KEY` | screenshot, api | |
| `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY` | rustfs | |
| `REDIS_URL` | api | Set in compose to the bundled Redis; edit the compose file to use another |

Losing `SETTINGS_ENCRYPTION_KEY` or `BACKUP_ENCRYPTION_KEY` makes what they protect unreadable. Back up
`.env`.

## Optional integrations (environment only)

`TMDB_API_KEY` (movie and series bookmarks), `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` (game
bookmarks via IGDB), `SENTRY_DSN` (error reports to a Sentry you run; nothing is sent by default),
`APPLE_CLIENT_IDS` (Sign in with Apple), `RAINDROP_*`, `DROPBOX_*`, `GOOGLE_DRIVE_*`, `REDDIT_*` (import and
backup connectors), `WELCOME_BOOKMARKS=false` (no sample bookmark for new accounts).

## Other knobs

| Variable | Default | |
|---|---|---|
| `QUEUE_DRIVER` | `redis` | `qstash` only for a deployment that uses Upstash |
| `JOB_WORKER` | on | `false` keeps the API enqueue-only |
| `MEILISEARCH_AUTO_SETUP` | on | `false`: do not create the search index and its settings at start-up |
| `MAX_UPLOAD_MB` | 500 | Parse upload limit |
| `PARSE_MASTER_KEY_IPS` | private ranges | Where the master key may be used from |
| `INTERNAL_API_URL` | `http://127.0.0.1:$PORT` | The API's address for calls to itself |
| `BACKEND_INTERNAL_URL`, `PARSE_INTERNAL_URL` | set by compose | How `web` reaches the API and Parse |
