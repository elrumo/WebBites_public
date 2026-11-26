# Configuration

Settings come from three places, strongest first:

1. **The environment** (`deploy/.env`, passed to the containers by `docker-compose.yml`). A setting
   defined here is *locked* on the admin page ("Set by the environment").
2. **The admin page** (/admin → Settings), stored in MongoDB. Secrets are encrypted with
   `SETTINGS_ENCRYPTION_KEY`.
3. **Built-in defaults.**

An empty variable counts as not set, so `FOO=` in `.env` does not lock anything.

`.env` wins over variables exported in your shell: a stray `S3_BUCKET` or `SENTRY_DSN` in your terminal never reaches the containers. (`docker-compose.yml` also reads `.env.example` for defaults, so keep that file next to it. The few values Compose computes itself, such as `PUBLIC_URL`, the ports, `WEBBITES_VERSION` and the generated secrets, can still be overridden for one command with `VAR=x docker compose ...`.)

## What the admin page can change

| Group | Variables | Takes effect |
|---|---|---|
| Email | `MAIL_PROVIDER`, `MAIL_FROM`, `SMTP_HOST/PORT/USER/PASS/SECURE`, `MAILGUN_API_KEY/DOMAIN/API_URL` | API at once; Parse after its restart |
| AI endpoint | `AI_API_BASE_URL`, `AI_API_KEY`, `AI_API_STYLE`, `AI_TEXT_MODEL`, `AI_MULTIMODAL_MODEL`, `EMBEDDING_MODEL` | at once |
| File storage | `FILES_DRIVER`, `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` | API at once; Parse after its restart |
| Search | `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` | after the API restarts |
| Screenshots | `SCREENSHOT_SERVICE_URL`, `SCREENSHOT_API_KEY` | at once |
| Sign in with Apple | `APPLE_CLIENT_IDS`, `APPLE_SIWA_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` | API and the button at once; Parse after its restart |
| Name and contact | `APP_NAME`, `SUPPORT_EMAIL` | API at once; Parse after its restart |

"Restart" means the **Restart** button the page shows after saving. It makes the service exit; Docker
(`restart: unless-stopped`) starts it again. No Docker socket is mounted anywhere. If Parse cannot
start with the saved values it starts with the previous working ones and the page says so.

## Sign in with Apple

Optional, and **off by default**: without an Apple Developer account it cannot work, so the "Continue
with Apple" button is not shown and the server refuses Apple sign-ins. It switches on when a Services ID
is saved on the admin page (/admin → Settings → Sign in with Apple) or set as `APPLE_CLIENT_IDS` in
`.env`. Clearing it switches it off again. The usual precedence applies: `.env` wins and locks the field.

In your Apple Developer account (Certificates, Identifiers & Profiles):

1. Create an **App ID** with the *Sign in with Apple* capability, then a **Services ID** and enable
   *Sign in with Apple* on it. This Services ID is the setting `APPLE_CLIENT_IDS`.
2. In the Services ID's configuration add your domain and the **Return URL**
   `https://<your domain>/auth/apple/callback` (the admin page shows yours). Apple accepts only a domain
   name served over HTTPS, so `localhost` and bare IP addresses cannot be used.
3. Optional: create a **Key** with *Sign in with Apple* and download the `.p8` file. Paste its contents,
   its Key ID and your Team ID into the three other fields (all three, or none). They let WebBites tell
   Apple to drop its link to an account when the account is deleted; sign-in itself does not need them.

`APPLE_CLIENT_IDS` takes several comma-separated ids. The first is the Services ID used by the web
button; add a native app's bundle id after it to accept that app's sign-ins as well.

Saving takes effect in the API at once. Parse reads the Services ID at start-up, so press **Restart**
on the page before trying it. The private key is stored encrypted and never shown again.

## What stays in `.env`

Things the services need before the page can load, or that must not be editable from a browser.

| Variable | Used by | |
|---|---|---|
| `PUBLIC_URL`, `SITE_ADDRESS`, `HTTP_PORT`, `HTTPS_PORT` | compose, Caddy | The address people use |
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
`RAINDROP_*`, `DROPBOX_*`, `GOOGLE_DRIVE_*`, `REDDIT_*` (import and
backup connectors), `WELCOME_BOOKMARKS=false` (no sample bookmark for new accounts).

## Other knobs

| Variable | Default | |
|---|---|---|
| `QUEUE_DRIVER` | `redis` | `qstash` only for a deployment that uses Upstash |
| `JOB_WORKER` | on | `false` keeps the API enqueue-only |
| `MEILISEARCH_AUTO_SETUP` | on | `false`: do not create the search index and its settings at start-up |
| `RENDER_PROVIDER` | automatic | `screenshot` or `siterelic`: who renders JavaScript-heavy pages when both a screenshot service and `SITERELIC_KEY` are set (default: the screenshot service) |
| `STORAGE_LEGACY_HOSTS` | none | Extra hosts (comma separated) whose file URLs count as this install's when an account's files are deleted, for a store that moved |
| `MAX_UPLOAD_MB` | 500 | Parse upload limit |
| `PARSE_MASTER_KEY_IPS` | private ranges and CGNAT | Where the master key may be used from |
| `ACCOUNT_LOCKOUT_THRESHOLD`, `ACCOUNT_LOCKOUT_MINUTES` | 10, 5 | Wrong passwords before an account is locked, and for how long |
| `PARSE_BIND_HOST` | every interface | The address Parse listens on (set it when Parse runs with `network_mode: host`) |
| `PARSE_CLIENT_ADD_FIELD` | on | `false`: leave `addField` shut on the client-written classes that already exist (Parse shuts it at every start); only for a database that has all its columns |
| `INTERNAL_API_URL` | `http://127.0.0.1:$PORT` | The API's address for calls to itself |
| `BACKEND_INTERNAL_URL`, `PARSE_INTERNAL_URL` | set by compose | How `web` reaches the API and Parse |
