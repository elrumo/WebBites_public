<template>
  <section>
    <h2 id="what-it-is">What it is</h2>
    <p class="docs-lead">
      WebBites is open source. The self-hosted edition is the same app as webbites.io, without payment
      plans, running on a server you control: your bookmarks, your database, your AI endpoint. No limits,
      every feature on, and nothing in it phones home.
    </p>
    <ul>
      <li><strong>One app or one command.</strong> Web app, API, Parse Server, MongoDB, Redis, Meilisearch and Caddy, set up and started for you. Nothing to clone or build.</li>
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
      <li><strong>Docker</strong>: Docker Desktop on a Mac or Windows PC, or Docker Engine with Compose 2.23 or newer on Linux.</li>
      <li><strong>2 GB of free memory</strong>, or about 3 GB with page previews (the screenshot service).</li>
      <li>To reach it from anywhere: a <strong>domain name</strong> pointing at the machine, with ports 80 and 443 open. To use it on one computer, nothing.</li>
    </ul>
  </section>

  <section>
    <h2 id="install">Install</h2>
    <p>Pick the way that suits where WebBites will run. They all set up the same thing.</p>
    <div class="docs-cards">
      <NuxtLink to="/developers/docs/self-hosting-app" class="docs-card docs-card-hover">
        <div class="docs-card-title">On your Mac, PC or Linux desktop</div>
        <div class="docs-card-text">
          Download the <strong>WebBites Server</strong> app. It checks Docker, asks two questions in your browser,
          installs, and then starts, stops and updates WebBites from the menu bar. No terminal.
        </div>
      </NuxtLink>
      <NuxtLink to="/developers/docs/self-hosting-terminal#one-command" class="docs-card docs-card-hover">
        <div class="docs-card-title">On a server, with one command</div>
        <div class="docs-card-text">
          One <code>curl … | sh</code> over SSH downloads the latest release, asks for your domain and starts
          WebBites with HTTPS.
        </div>
      </NuxtLink>
      <NuxtLink to="/developers/docs/self-hosting-terminal#by-hand" class="docs-card docs-card-hover">
        <div class="docs-card-title">By hand, with compose.yaml</div>
        <div class="docs-card-text">
          One compose file and an <code>.env</code> you write yourself. Every line in view, easy to fit into a
          setup you already have.
        </div>
      </NuxtLink>
      <NuxtLink to="/developers/docs/self-hosting-terminal#cli" class="docs-card docs-card-hover">
        <div class="docs-card-title">With the webbites-server command</div>
        <div class="docs-card-text">
          The app's command-line side, for servers: <code>install</code>, <code>status</code>,
          <code>update</code>, <code>logs</code>.
        </div>
      </NuxtLink>
    </div>
    <figure class="docs-figure">
      <img :src="`${SHOTS}/where.webp`" width="1200" height="1139" loading="lazy" decoding="async"
        alt="WebBites Server asking where you will use WebBites: on this Mac, or on a server at your own address">
      <figcaption>The WebBites Server app's first question</figcaption>
    </figure>
    <p>
      The images are published on Docker Hub as <code>elrumo/webbites-web</code>,
      <code>elrumo/webbites-api</code>, <code>elrumo/webbites-parse</code> and
      <code>elrumo/webbites-screenshot</code>, for both <code>amd64</code> and <code>arm64</code>, and every
      way above uses them: nothing is built on your machine.
    </p>
  </section>

  <section>
    <h2 id="first-account">Claim the install</h2>
    <p>
      Open your WebBites (the address the installer shows) and <strong>create your account straight away: the first account
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
      Next: install with <NuxtLink to="/developers/docs/self-hosting-app">the WebBites Server app</NuxtLink> or
      <NuxtLink to="/developers/docs/self-hosting-terminal">from the terminal</NuxtLink>, then read
      <NuxtLink to="/developers/docs/self-hosting-operations">configuration, backups and upgrades</NuxtLink>.
    </p>
  </section>
</template>

<script setup>
import DevCode from '~/components/developers/DevCode.vue'
import { SELF_HOST_REPO_URL as REPO_URL, SELF_HOST_SHOTS as SHOTS } from '~/utils/devApi'

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
  { name: 'screenshot', role: 'The headless browser that screenshots pages and renders JavaScript. Optional (page previews): leave it out to save about 1 GB of RAM.' },
  { name: 'rustfs', role: 'Optional (separate file storage): an S3-compatible store for uploads, instead of MongoDB.' },
]
</script>
