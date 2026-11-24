<template>
  <section>
    <h2 id="what-it-is">What it is</h2>
    <p class="docs-lead">
      WebBites is open source. The self-hosted edition is the same app as webbites.io, without payment
      plans, running on a server you control: your bookmarks, your database, your AI endpoint. No limits,
      every feature on, and nothing in it phones home.
    </p>
    <ul>
      <li><strong>One compose file.</strong> Web app, API, Parse Server, MongoDB, Redis, Meilisearch and Caddy, started with one command. Nothing to clone or build.</li>
      <li><strong>HTTPS included.</strong> Caddy gets and renews the certificate for your domain by itself.</li>
      <li><strong>AGPL-3.0.</strong> If you modify it and offer it to other people over a network, you offer them your modified source.</li>
    </ul>
    <div class="docs-note">
      The code and the issue tracker live at
      <a :href="REPO_URL" target="_blank" rel="noopener">github.com/elrumo/webbites_public</a>.
      The self-hosted edition is new, so expect rough edges and please open issues.
    </div>
  </section>

  <section>
    <h2 id="requirements">What you need</h2>
    <ul>
      <li>A Linux or macOS machine with <strong>Docker and Docker Compose 2.23 or newer</strong>.</li>
      <li><strong>2 GB of RAM</strong>, or about 3 GB if you also run the screenshot service.</li>
      <li>For a public install, a <strong>domain name</strong> pointing at the machine, with ports 80 and 443 open.</li>
    </ul>
  </section>

  <section>
    <h2 id="install">Install</h2>
    <p>
      Make a folder, download <code>compose.yaml</code> into it and write a <code>.env</code> next to it with
      your address and fresh secrets. Change <code>PUBLIC_URL</code> to your domain first, or use
      <code>http://localhost</code> to try it on one machine.
    </p>
    <DevCode :code="INSTALL" language="bash" label="Terminal" />
    <p>
      That is the whole install. <code>compose.yaml</code> is the setup, the same for everyone, and is shown
      in full below. <code>.env</code> holds what is yours: the address and the secrets. Keep it private and
      back it up; upgrading replaces <code>compose.yaml</code> and never touches it.
    </p>
    <p>
      The images are published on Docker Hub as <code>elrumo/webbites-web</code>,
      <code>elrumo/webbites-api</code>, <code>elrumo/webbites-parse</code> and
      <code>elrumo/webbites-screenshot</code>, for both <code>amd64</code> and <code>arm64</code>.
    </p>
  </section>

  <section>
    <h2 id="compose-file">The compose file</h2>
    <p>
      Download it from <a :href="COMPOSE_URL">{{ COMPOSE_URL }}</a> or copy it from here. Email, AI, file
      storage and the rest are set from the admin page, so they are not in it.
    </p>
    <DevCode :code="COMPOSE" language="yaml" label="compose.yaml" />
  </section>

  <section>
    <h2 id="first-account">Claim the install</h2>
    <p>
      Open your <code>PUBLIC_URL</code> and <strong>create your account straight away: the first account
      becomes the administrator.</strong> With <code>INITIAL_ADMIN_EMAIL</code> set, only that address can
      claim it, so a stranger who finds the server first cannot. Leave it empty and whoever signs up first
      wins, so do not leave a fresh install unattended on the internet.
    </p>
    <p>
      Then, as administrator, open <strong>/admin → Settings</strong> to connect email, an AI endpoint, file
      storage and the rest. No file editing needed.
    </p>
    <div class="docs-note warn">
      Anyone who can reach the server can sign up; there is no invite-only mode yet. If the server should
      stay private, put it behind a VPN or an authenticating proxy.
    </div>
  </section>

  <section>
    <h2 id="what-runs">What runs</h2>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Container</th><th>Role</th></tr></thead>
        <tbody>
          <tr v-for="row in SERVICES" :key="row.name">
            <td><code>{{ row.name }}</code></td>
            <td>{{ row.role }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Only Caddy listens on the network. MongoDB, Redis, Meilisearch and the screenshot service publish no
      ports at all.
    </p>
  </section>

  <section>
    <h2 id="your-api">Using the API on your server</h2>
    <p>
      The API and MCP server run on your own domain, so everything in these docs works against it. Replace
      <code>https://api.webbites.io/v1/api</code> with your address. Create a developer key in the app
      on the Developers page, then:
    </p>
    <DevCode :code="OWN_API" language="bash" label="Your server" />
    <ul>
      <li>OpenAPI reference: <code>https://your.domain/_docs/scalar</code></li>
      <li>MCP server for AI assistants: <code>https://your.domain/mcp</code></li>
    </ul>
    <p>
      Self-hosted installs have no plans, so the rate limits on
      <NuxtLink to="/developers/docs/rate-limits">Rate limits</NuxtLink> are the hosted service's and do
      not apply.
    </p>
  </section>

  <section>
    <h2 id="not-yet">What is different, and what is missing</h2>
    <ul>
      <li>There is no marketing site: <code>/</code> goes to sign-in.</li>
      <li>Email, AI, screenshots and search run on services you provide, all set from the admin page.</li>
      <li>The browser extension and the iOS and macOS apps are built against webbites.io and have no server-address setting yet. Use the web app (it installs as a PWA), the API or MCP.</li>
      <li>Not built yet: invite-only sign-ups, an importer for boards and tags from a webbites.io backup, and running more than one Parse instance.</li>
    </ul>
    <p>
      Next: <NuxtLink to="/developers/docs/self-hosting-operations">configuration, backups and upgrades</NuxtLink>.
    </p>
  </section>
</template>

<script setup>
import DevCode from '~/components/developers/DevCode.vue'
import { SELF_HOST_REPO_URL as REPO_URL, SELF_HOST_COMPOSE_URL } from '~/utils/devApi'
// The same file the site serves for download, so the page and the download never differ.
// Relative, not ~~/: ~~ is the root of whichever project is being built, which is not this one when another project extends this app.
import COMPOSE from '../../../public/self-hosting/compose.yaml?raw'

const COMPOSE_URL = SELF_HOST_COMPOSE_URL

const INSTALL = `mkdir webbites && cd webbites
curl -fsSLO ${COMPOSE_URL}

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

docker compose up -d`

const OWN_API = `curl https://your.domain/v1/api/bookmarks?limit=5 \\
  -H "Authorization: Bearer wb_live_…"`

const SERVICES = [
  { name: 'caddy', role: 'The only thing that listens on ports 80 and 443. Gets the HTTPS certificate.' },
  { name: 'web', role: 'The Nuxt web app.' },
  { name: 'api', role: 'The backend: bookmarks, search, background jobs, the public API and the MCP server.' },
  { name: 'parse', role: 'Parse Server: accounts, data, live updates and file serving.' },
  { name: 'mongo', role: 'The database, and file storage unless you choose S3.' },
  { name: 'redis', role: 'Job queue, rate limits and developer API keys. Persisted: it is not just a cache.' },
  { name: 'meilisearch', role: 'Search.' },
  { name: 'screenshot', role: 'The headless browser that screenshots pages and renders JavaScript. Optional: delete it from compose.yaml to save about 1 GB of RAM.' },
]
</script>
