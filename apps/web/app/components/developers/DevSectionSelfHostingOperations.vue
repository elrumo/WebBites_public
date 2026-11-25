<template>
  <section>
    <h2 id="configuration">Configuration</h2>
    <p>Settings come from three places, strongest first:</p>
    <ol>
      <li><strong>The environment</strong>: the variables in <code>compose.yaml</code>, most of which read their value from <code>.env</code>. A setting defined here is locked on the admin page as “Set by the environment”.</li>
      <li><strong>The admin page</strong> (<code>/admin → Settings</code>), stored in MongoDB. Secrets are encrypted with <code>SETTINGS_ENCRYPTION_KEY</code>.</li>
      <li><strong>Built-in defaults.</strong></li>
    </ol>
    <p>An empty variable counts as not set, so <code>FOO=</code> in <code>.env</code> locks nothing.</p>

    <h3 id="admin-page">What the admin page can change</h3>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Group</th><th>Covers</th></tr></thead>
        <tbody>
          <tr><td>Email</td><td>SMTP or Mailgun, and the sender address</td></tr>
          <tr><td>AI endpoint</td><td>Any OpenAI-style endpoint (or a local model), and the text, multimodal and embedding models</td></tr>
          <tr><td>File storage</td><td>MongoDB, or any S3-compatible bucket</td></tr>
          <tr><td>Search</td><td>Meilisearch host and key</td></tr>
          <tr><td>Screenshots</td><td>The screenshot service address and key</td></tr>
          <tr><td>Name and contact</td><td>App name and support email</td></tr>
        </tbody>
      </table>
    </div>
    <p>
      After saving, the page shows a <strong>Restart</strong> button where a service needs one. Docker
      starts it again; no Docker socket is mounted anywhere.
    </p>

    <h3 id="env-file">What stays in .env</h3>
    <p>
      Things the services need before the page can load, or that must not be editable from a browser: the
      public address (<code>PUBLIC_URL</code>), <code>WEBBITES_VERSION</code>, <code>INITIAL_ADMIN_EMAIL</code>
      and the generated secrets (Parse keys, <code>MONGO_PASSWORD</code>, <code>SETTINGS_ENCRYPTION_KEY</code>,
      <code>BACKUP_ENCRYPTION_KEY</code> and so on).
    </p>
    <p>
      A few optional integrations have no admin field: <code>TMDB_API_KEY</code> (movies),
      <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code> (games) and <code>SENTRY_DSN</code>.
      Add them to <code>.env</code> and to the <code>environment:</code> of the services that use them in
      <code>compose.yaml</code>: <code>web</code> and <code>api</code> for the first three, <code>api</code>
      and <code>parse</code> for Sentry.
    </p>
    <div class="docs-note warn">
      Losing <code>SETTINGS_ENCRYPTION_KEY</code> or <code>BACKUP_ENCRYPTION_KEY</code> makes what they
      protect unreadable. Back up <code>.env</code>, keep it private (<code>chmod 600</code>) and out of git.
    </div>
  </section>

  <section>
    <h2 id="upgrading">Upgrading</h2>
    <p>
      Images are tagged with the release version, and <code>WEBBITES_VERSION</code> in <code>.env</code>
      picks one. The app and the one-line installer pin it to the release they installed; <code>install.sh</code>
      from a clone and a hand-written <code>.env</code> without it use <code>latest</code>. How to move to a new release depends on how you installed:
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Installed with</th><th>Upgrade</th></tr></thead>
        <tbody>
          <tr><td>The WebBites Server app</td><td><strong>Update</strong> on the banner, or <strong>Update to x.y.z…</strong> in the menu</td></tr>
          <tr><td>The one-line installer</td><td>Run the same <code>curl … get.sh | sh</code> again in the same place</td></tr>
          <tr><td>The <code>webbites-server</code> command</td><td><code>webbites-server update</code> (<code>--version x.y.z</code> for a given one)</td></tr>
          <tr><td>compose.yaml by hand</td><td>The commands below</td></tr>
          <tr><td>A clone</td><td><code>git pull</code>, then <code>docker compose pull</code> and <code>docker compose up -d</code> in <code>deploy/</code></td></tr>
        </tbody>
      </table>
    </div>
    <p>
      The first three keep the previous release's files in <code>.previous</code> in the WebBites folder and
      never touch <code>.env</code> beyond <code>WEBBITES_VERSION</code>. By hand:
    </p>
    <DevCode :code="UPGRADE" language="bash" label="Terminal" />
    <p>
      If you edited <code>compose.yaml</code> (a trusted proxy, no screenshot service), see what changed
      before replacing it: <code>curl -fsSL {{ SELF_HOST_COMPOSE_URL }} | diff compose.yaml -</code>.
    </p>
    <p>
      Compose recreates only containers whose image changed, and Parse and the API run any data upgrades
      they need when they start.
    </p>
    <ul>
      <li><strong>Pin versions.</strong> Set <code>WEBBITES_VERSION=1.2.3</code> so a restart never pulls something new by surprise, and bump it deliberately.</li>
      <li><strong>Back up first</strong>, especially across a major version.</li>
      <li><strong>Roll back</strong> by setting the previous version and running <code>docker compose up -d</code>. If the new version changed the data format, restore your backup.</li>
    </ul>
  </section>

  <section>
    <h2 id="backups">Backups and restore</h2>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Holds</th><th>If lost</th></tr></thead>
        <tbody>
          <tr><td><code>mongo_data</code>: accounts, bookmarks, boards, notes, settings, and files unless you use S3</td><td>Everything is gone</td></tr>
          <tr><td><code>redis_data</code>: developer API keys, queued jobs</td><td>API keys stop working; users create new ones</td></tr>
          <tr><td>Your S3 bucket, if you chose one: files</td><td>Images and attachments are gone</td></tr>
          <tr><td><code>meili_data</code>: the search index</td><td>Nothing: rebuild it from Admin → Search index → Sync now</td></tr>
          <tr><td><code>.env</code>: every secret</td><td>Encrypted settings and backups cannot be read</td></tr>
        </tbody>
      </table>
    </div>
    <p>The three that matter, while the stack runs:</p>
    <DevCode :code="BACKUP" language="bash" label="Backup" />
    <p>Restore on a fresh install (or after deleting the volumes), with the original <code>.env</code> in place:</p>
    <DevCode :code="RESTORE" language="bash" label="Restore" />
    <p>
      Keep backups somewhere that is not this machine, encrypted: they contain everything, including your
      users' data. Test a restore once, on a spare machine, before you need it.
    </p>
  </section>

  <section>
    <h2 id="security">Security</h2>
    <ul>
      <li><strong>One door.</strong> Only Caddy is reachable, on ports 80 and 443. The API's internal routes are not forwarded and refuse requests without the internal key anyway.</li>
      <li><strong>The master key.</strong> <code>PARSE_MASTER_KEY</code> bypasses every permission. It is only honoured from private network ranges, which includes the containers and excludes the internet.</li>
      <li><strong>No telemetry.</strong> No analytics and no error reporting by default; <code>SENTRY_DSN</code> sends reports only to a Sentry you run. Nothing contacts webbites.io.</li>
      <li><strong>Fetching pages.</strong> The server refuses private and loopback addresses, including after redirects, and the screenshot browser runs on its own network.</li>
      <li><strong>Behind another proxy</strong> (Cloudflare, a load balancer)? Tell Caddy to trust it in the Caddyfile at the bottom of <code>compose.yaml</code>, or rate limits see the wrong address.</li>
    </ul>
    <p>
      Report vulnerabilities as described in
      <a :href="SECURITY_URL" target="_blank" rel="noopener">SECURITY.md</a>.
    </p>
  </section>

  <section>
    <h2 id="moving">Moving from webbites.io</h2>
    <ol>
      <li>In the hosted app, go to <strong>Settings → Backups</strong> and back up now (or download a backup). The zip holds <code>bookmarks.html</code>: every live bookmark in the standard browser format.</li>
      <li>On your install, click <strong>Import</strong> and choose <code>bookmarks.html</code>. Each address is fetched and processed again, so titles, summaries, screenshots and search are rebuilt by your server. A large library takes a while, and a lot of AI calls if you configured an endpoint.</li>
    </ol>
    <p>
      Boards, tags and notes are in the backup's JSON files but have no importer yet, and accounts,
      passwords, developer keys and MCP connections have to be created again.
    </p>
  </section>
</template>

<script setup>
import DevCode from '~/components/developers/DevCode.vue'
import { SELF_HOST_REPO_URL, SELF_HOST_COMPOSE_URL } from '~/utils/devApi'

const SECURITY_URL = `${SELF_HOST_REPO_URL}/blob/main/SECURITY.md`

const UPGRADE = `cd webbites
curl -fsSLO ${SELF_HOST_COMPOSE_URL}   # the release may have changed it
docker compose pull
docker compose up -d`

const BACKUP = `cd webbites
set -a; . ./.env; set +a
STAMP=$(date +%F)

# MongoDB (a consistent dump)
docker compose exec -T mongo mongodump -u webbites -p "$MONGO_PASSWORD" --authenticationDatabase admin \\
  --archive --gzip > "mongo-$STAMP.archive.gz"

# Redis: save, then copy the append-only file out
docker compose exec -T redis redis-cli SAVE
docker run --rm -v webbites_redis_data:/data -v "$PWD":/out alpine tar czf "/out/redis-$STAMP.tgz" -C /data .

# The secrets
cp .env "env-$STAMP.backup" && chmod 600 "env-$STAMP.backup"`

const RESTORE = `docker compose up -d mongo redis
docker compose exec -T mongo mongorestore -u webbites -p "$MONGO_PASSWORD" --authenticationDatabase admin \\
  --archive --gzip --drop < mongo-2025-01-01.archive.gz

docker compose stop redis
docker run --rm -v webbites_redis_data:/data -v "$PWD":/in alpine sh -c 'rm -rf /data/* && tar xzf /in/redis-2025-01-01.tgz -C /data'
docker compose up -d

# then open Admin → Search index → Sync now to rebuild search`
</script>
