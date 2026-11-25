<template>
  <section>
    <h2 id="which">Which way</h2>
    <p class="docs-lead">
      Four ways in, all ending in the same place: a folder with the compose setup and an <code>.env</code> of
      fresh secrets, running in Docker. Pick by where WebBites will run.
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Way</th><th>Best for</th><th>Upgrade by</th></tr></thead>
        <tbody>
          <tr>
            <td><a href="#one-command">One command</a></td>
            <td>A Linux server or VPS over SSH. The quickest.</td>
            <td>Running the same command again</td>
          </tr>
          <tr>
            <td><a href="#cli">The <code>webbites-server</code> command</a></td>
            <td>A server you also want to start, stop, update and read logs on with short commands.</td>
            <td><code>webbites-server update</code></td>
          </tr>
          <tr>
            <td><a href="#by-hand">By hand with <code>compose.yaml</code></a></td>
            <td>Seeing every line, or fitting WebBites into a setup you already have.</td>
            <td>Downloading the file again, then <code>docker compose pull</code></td>
          </tr>
          <tr>
            <td><a href="#from-a-clone">From a clone</a></td>
            <td>Following the code, or contributing.</td>
            <td><code>git pull</code></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      On your own Mac, PC or Linux desktop, the
      <NuxtLink to="/developers/docs/self-hosting-app">WebBites Server app</NuxtLink> does all of this without a
      terminal.
    </p>
  </section>

  <section>
    <h2 id="one-command">One command</h2>
    <p>On a machine with Docker, run:</p>
    <DevCode :code="GET" language="bash" label="Terminal" />
    <p>
      It downloads only the deployment files of the latest release into <code>./webbites</code> (no clone,
      nothing to build), asks a few questions, writes <code>.env</code> with fresh secrets, pulls the images
      and starts WebBites. The questions:
    </p>
    <ol>
      <li><strong>Domain</strong>: your domain, such as <code>bookmarks.example.com</code>, for HTTPS from anywhere. Or <code>localhost</code> to try it on this machine.</li>
      <li><strong>Email</strong>: only an account with this address can become the administrator. Leave it empty and the first account to sign up does.</li>
      <li><strong>Page previews</strong>: the screenshot service, about 1 GB of memory.</li>
      <li><strong>Separate file storage</strong>: a bundled S3 store for uploads instead of the database.</li>
    </ol>
    <p>Give the answers up front to skip the questions, for a script or a provisioning tool:</p>
    <DevCode :code="GET_ANSWERS" language="bash" label="Terminal" />
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Option</th><th>Does</th></tr></thead>
        <tbody>
          <tr v-for="row in OPTIONS" :key="row.flag">
            <td><code>{{ row.flag }}</code></td>
            <td>{{ row.does }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      <strong>To upgrade</strong>, run the same command again in the same place. The deployment files are
      replaced by the new release's (the old ones are kept in <code>webbites/.previous</code>), and
      <code>.env</code> is kept with its <code>WEBBITES_VERSION</code> moved on.
    </p>
    <div class="docs-note">
      <p>
        Want to read it before running it? It is short:
        <a :href="GET_URL" target="_blank" rel="noopener">deploy/get.sh</a>. Or download it first:
        <code>curl -fsSLO {{ GET_URL }}</code>, read it, then <code>sh get.sh</code>.
      </p>
    </div>
  </section>

  <section>
    <h2 id="cli">The <code>webbites-server</code> command</h2>
    <p>
      The <NuxtLink to="/developers/docs/self-hosting-app">WebBites Server app</NuxtLink> is also a command-line
      tool, so a server without a desktop can use it too. Download it for Linux:
    </p>
    <DevCode :code="CLI_DOWNLOAD" language="bash" label="Terminal" />
    <p>Then:</p>
    <DevCode :code="CLI" language="bash" label="Terminal" />
    <p>
      Every command takes <code>--dir &lt;folder&gt;</code>; the default is the folder used last, or
      <code>~/WebBites</code>. It manages installs made the other ways too: point it at their folder.
    </p>
    <p>
      <code>webbites-server ui</code> starts the same setup page as the app, on <code>127.0.0.1</code> only.
      From your own computer, reach it through an SSH tunnel to the port it prints:
    </p>
    <DevCode :code="TUNNEL" language="bash" label="Your computer" />
  </section>

  <section>
    <h2 id="by-hand">By hand with compose.yaml</h2>
    <p>
      Make a folder, download <code>compose.yaml</code> into it and write a <code>.env</code> next to it with
      your address and fresh secrets. Change <code>PUBLIC_URL</code> to your domain first, or use
      <code>http://localhost</code> to try it on one machine.
    </p>
    <DevCode :code="INSTALL" language="bash" label="Terminal" />
    <p>
      That is the whole install. <code>compose.yaml</code> is the setup, the same for everyone, and is shown in
      full below. <code>.env</code> holds what is yours: the address and the secrets. Keep it private and back
      it up; upgrading replaces <code>compose.yaml</code> and never touches it.
    </p>
    <p>
      The images are published on Docker Hub as <code>elrumo/webbites-web</code>,
      <code>elrumo/webbites-api</code>, <code>elrumo/webbites-parse</code> and
      <code>elrumo/webbites-screenshot</code>, for both <code>amd64</code> and <code>arm64</code>.
    </p>

    <h3 id="compose-file">The compose file</h3>
    <p>
      Download it from <a :href="COMPOSE_URL">{{ COMPOSE_URL }}</a> or copy it from here. Email, AI, file
      storage and the rest are set from the admin page, so they are not in it.
    </p>
    <DevCode :code="COMPOSE" language="yaml" label="compose.yaml" />
  </section>

  <section>
    <h2 id="from-a-clone">From a clone</h2>
    <DevCode :code="CLONE" language="bash" label="Terminal" />
    <p>
      <code>install.sh</code> asks the same questions as the one-line installer, takes the same options, and
      never overwrites an existing <code>.env</code>. To upgrade, <code>git pull</code>, then
      <code>docker compose pull</code> and <code>docker compose up -d</code> in <code>deploy/</code>.
    </p>
  </section>

  <section>
    <h2 id="then">Then</h2>
    <p>
      Open the address it prints and <strong>create your account straight away</strong>: the first account
      becomes the administrator. See <NuxtLink to="/developers/docs/self-hosting#first-account">Claim the install</NuxtLink>,
      then <NuxtLink to="/developers/docs/self-hosting-operations">configuration, backups and upgrades</NuxtLink>.
    </p>
  </section>
</template>

<script setup>
import DevCode from '~/components/developers/DevCode.vue'
import { SELF_HOST_REPO_URL, SELF_HOST_COMPOSE_URL as COMPOSE_URL, SELF_HOST_GET_URL as GET_URL, SELF_HOST_DOWNLOAD_URL } from '~/utils/devApi'
// The same file the site serves for download, so the page and the download never differ.
// Relative, not ~~/: ~~ is the root of whichever project is being built, which is not this one when another project extends this app.
import COMPOSE from '../../../public/self-hosting/compose.yaml?raw'

const GET = `curl -fsSL ${GET_URL} | sh`

const GET_ANSWERS = `curl -fsSL ${GET_URL} \\
  | sh -s -- --domain bookmarks.example.com --email you@example.com --yes`

const OPTIONS = [
  { flag: '--domain <name>', does: 'Your domain, or localhost.' },
  { flag: '--email <address>', does: 'The only address that can become the administrator.' },
  { flag: '--http-port <port>', does: 'For localhost: the port to use if 80 is taken (for example 8080).' },
  { flag: '--no-screenshots', does: 'No page previews; saves about 1 GB of memory.' },
  { flag: '--rustfs', does: 'Keep uploads in the bundled S3 store.' },
  { flag: '--yes', does: 'Ask nothing; use the answers given and the defaults.' },
  { flag: '--dir <folder>', does: 'Where WebBites lives (default ./webbites).' },
  { flag: '--version <x.y.z>', does: 'A specific release instead of the latest.' },
  { flag: '--no-start', does: 'Set up or upgrade the files only; start later with docker compose up -d.' },
]

const CLI_DOWNLOAD = `# x64 servers; use linux-arm64 on Arm
curl -fsSL ${SELF_HOST_DOWNLOAD_URL('WebBites-Server-linux-amd64.tar.gz')} | tar xz
sudo install WebBites-Server-linux-amd64/webbites-server /usr/local/bin/`

const CLI = `webbites-server install          # the same questions (or --domain ... --email ... --yes)
webbites-server status           # running? which version, which address
webbites-server update           # to the latest release (--version x.y.z for another)
webbites-server start | stop | restart
webbites-server logs api -f      # one part's logs: web, api, parse, mongo, ...
webbites-server ui               # the setup page, through an SSH tunnel`

const TUNNEL = `ssh -L 8765:127.0.0.1:<port> you@your-server
# then open the address it printed, with 8765 in place of its port`

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

const CLONE = `git clone ${SELF_HOST_REPO_URL}.git
cd webbites_public/deploy
./install.sh            # or: ./install.sh --domain bookmarks.example.com --email you@example.com --yes
docker compose pull
docker compose up -d`
</script>
