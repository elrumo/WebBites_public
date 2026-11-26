<template>
  <section>
    <h2 id="what-it-is">What it is</h2>
    <p class="docs-lead">
      WebBites Server is a small app for macOS, Windows and Linux that sets WebBites up with Docker and then
      runs it for you. No terminal, no files to edit: it asks a couple of questions in your browser and does
      the rest.
    </p>
    <ul>
      <li><strong>It lives in the menu bar</strong> (the notification area on Windows and Linux) and shows whether WebBites is running.</li>
      <li><strong>It installs, starts, stops and updates</strong> WebBites, and shows what each part is doing.</li>
      <li><strong>Quitting it leaves WebBites running.</strong> WebBites lives in Docker, not in the app, so you only need the app to change something.</li>
    </ul>
    <p>
      It is the easiest way to run WebBites on your own computer. On a server you reach over SSH, the same
      file works as a command-line tool: see <NuxtLink to="/developers/docs/self-hosting-terminal">Install from the terminal</NuxtLink>.
    </p>
  </section>

  <section>
    <h2 id="download">Download</h2>
    <p>
      Every release has the app attached. Pick the file for your computer from the
      <a :href="RELEASES_URL" target="_blank" rel="noopener">latest release</a>, or use these links:
    </p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>Computer</th><th>Download</th><th>Then</th></tr></thead>
        <tbody>
          <tr v-for="row in DOWNLOADS" :key="row.os">
            <td><strong>{{ row.os }}</strong><br><span class="text-neutral-500">{{ row.detail }}</span></td>
            <td class="whitespace-nowrap">
              <template v-for="(f, i) in row.files" :key="f.file">
                <br v-if="i">
                <a :href="DOWNLOAD(f.file)" :title="f.file">{{ f.label }}</a>
              </template>
            </td>
            <td>{{ row.then }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="docs-note">
      <p>
        You also need <strong>Docker</strong>: <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">Docker Desktop</a>
        on a Mac or PC, or Docker Engine with the Compose plugin on Linux. Install it whenever you like; the
        app checks for it first and waits until it is running. Plan for 2 GB of free memory, or 3 GB with
        page previews.
      </p>
    </div>
    <p>
      The first time you open an app downloaded from the internet, your computer may ask whether you trust
      it. On a Mac, if it says it can't check the app, open <strong>System Settings → Privacy &amp; Security</strong> and choose <strong>Open Anyway</strong> (on macOS 14 and earlier, right-click the app and choose <strong>Open</strong>). On
      Windows, if SmartScreen appears, choose <strong>More info → Run anyway</strong>.
    </p>
  </section>

  <section>
    <h2 id="set-up">Set it up, step by step</h2>
    <p>Open WebBites Server. The first time, it opens its setup page in your browser by itself.</p>

    <h3 id="step-docker">1. Docker</h3>
    <p>
      If Docker is missing or not running, the page says which, and has a button to get it. Install it, open
      it once, and come back: the page notices on its own and moves on. If Docker is ready, you skip this step.
    </p>
    <figure class="docs-figure">
      <img v-bind="shot('docker')" alt="The setup page asking for Docker, with three steps and a Get Docker button">
    </figure>

    <h3 id="step-where">2. Where you will use it</h3>
    <figure class="docs-figure">
      <img v-bind="shot('where')" alt="Two choices: On this Mac, or On a server, at my own address">
    </figure>
    <ul>
      <li><strong>On this Mac</strong> (or PC, or computer): WebBites runs on this computer and opens at <code>http://localhost</code>. Nothing to configure. Pick this to use it yourself, or to try it.</li>
      <li><strong>On a server, at my own address</strong>: WebBites answers at your own domain, with HTTPS, from anywhere. Pick this when the app runs on the machine that will serve WebBites, and you have a domain name pointing at it.</li>
      <li><strong>Open an existing install</strong>: if WebBites is already set up in a folder (by the app, the one-line installer or <code>install.sh</code>), point the app at that folder to manage it.</li>
    </ul>

    <h3 id="step-details">3. A few details</h3>
    <div class="docs-figures">
      <figure class="docs-figure">
        <img v-bind="shot('details-computer')" alt="The details form for this computer, with the Advanced options open">
        <figcaption>On this computer, with Advanced open</figcaption>
      </figure>
      <figure class="docs-figure">
        <img v-bind="shot('details-server')" alt="The details form for a server, asking for the domain">
        <figcaption>On a server</figcaption>
      </figure>
    </div>
    <ul>
      <li><strong>Your domain</strong> (server only), such as <code>bookmarks.example.com</code>. Point its DNS record at the server and open ports 80 and 443 first; the HTTPS certificate is then set up for you.</li>
      <li><strong>Your email</strong>, optional but recommended: only an account with this address can become the administrator. Leave it empty and the first account to sign up does.</li>
    </ul>
    <p>Most people never open <strong>Advanced</strong>. It holds:</p>
    <ul>
      <li><strong>Page previews</strong> (on): screenshots of the pages you save. Uses about 1 GB of memory; turn it off on a small machine.</li>
      <li><strong>Separate file storage</strong> (off): keeps uploads in a bundled S3 store instead of the database. Better for big libraries.</li>
      <li><strong>Port</strong> (this computer only): already filled in with one that is free, so it works even if another app uses port 80.</li>
      <li><strong>Folder</strong>: where WebBites keeps its settings, <code>~/WebBites</code> by default. Your bookmarks themselves live in Docker.</li>
    </ul>

    <h3 id="step-install">4. Install</h3>
    <p>
      Click <strong>Install WebBites</strong> and the page shows each step as it happens. The first time takes
      a few minutes, mostly to download WebBites. You can close the page: it keeps going, and the menu shows
      when it is done.
    </p>
    <div class="docs-figures">
      <figure class="docs-figure">
        <img v-bind="shot('installing')" alt="Setting things up: four steps, two done, one in progress">
        <figcaption>Installing</figcaption>
      </figure>
      <figure class="docs-figure">
        <img v-bind="shot('failed')" alt="That didn't work: the failed step, a plain explanation and a Try again button">
        <figcaption>If something goes wrong</figcaption>
      </figure>
    </div>
    <p>
      If a step fails, the page says what happened in plain words and whether anything was changed.
      <strong>Try again</strong> takes you back to your answers. <strong>Show details</strong> has the full log,
      which is what to paste into an issue.
    </p>

    <h3 id="step-ready">5. Create your account</h3>
    <figure class="docs-figure">
      <img v-bind="shot('ready')" alt="WebBites is ready, with two things to do next and an Open WebBites button">
    </figure>
    <ol>
      <li><strong>Open WebBites and sign up straight away.</strong> The first account becomes the administrator (or the account with your email, if you gave one).</li>
      <li><strong>Copy the <code>.env</code> file</strong> from the WebBites folder somewhere safe. It holds the keys your data is encrypted with; without it a backup can't be read.</li>
    </ol>
    <p>
      Then, as administrator, open <strong>/admin → Settings</strong> in WebBites to connect email, an AI
      endpoint and the rest.
    </p>
  </section>

  <section>
    <h2 id="every-day">Every day</h2>
    <p>
      Open the setup page again from the menu, with <strong>Settings and logs…</strong>, to see how WebBites is
      doing. At the top: whether it is running, its version and address, <strong>Open WebBites</strong> and
      <strong>Start</strong> or <strong>Stop</strong>. When a new release is out, a banner offers it.
    </p>
    <figure class="docs-figure">
      <img v-bind="shot('home')" alt="WebBites Server home: an update banner, Running, the address, Open WebBites, Stop and the list of services">
    </figure>

    <h3 id="overview">Overview</h3>
    <p>Each part of WebBites, with a plain name and its state (Healthy, Starting…, Having trouble, Stopped):</p>
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead><tr><th>In the app</th><th>Container</th><th>Does</th></tr></thead>
        <tbody>
          <tr v-for="row in PARTS" :key="row.name">
            <td>{{ row.label }}</td>
            <td><code>{{ row.name }}</code></td>
            <td>{{ row.role }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3 id="logs">Logs</h3>
    <p>
      The latest lines from everything, or from one part. When something misbehaves, this is where to look,
      and what to paste into an issue.
    </p>
    <figure class="docs-figure">
      <img v-bind="shot('logs')" alt="The Logs tab: a button per part and the latest log lines">
    </figure>

    <h3 id="settings">Settings</h3>
    <p>
      The address and folder (with <strong>Show</strong> to open it), a reminder about backups,
      <strong>Restart</strong>, <strong>Another install</strong> to manage WebBites in a different folder, and
      the versions of WebBites and of the app.
    </p>
    <figure class="docs-figure">
      <img v-bind="shot('settings')" alt="The Settings tab: address, folder, backups, restart, another install and version">
    </figure>

    <h3 id="menu">The menu</h3>
    <p>Everything day to day is also in the menu-bar icon:</p>
    <ul>
      <li><strong>Running · 0.7.0</strong> (or Stopped, or Docker is not running): the state at a glance.</li>
      <li><strong>Open WebBites</strong>: your WebBites in the browser.</li>
      <li><strong>Start</strong> and <strong>Stop</strong>.</li>
      <li><strong>Update to x.y.z…</strong>, only when a release is out. It opens the page, which asks before updating.</li>
      <li><strong>Settings and logs…</strong> and <strong>Show folder</strong>.</li>
      <li><strong>Quit WebBites Server</strong>: closes the app; WebBites keeps running.</li>
    </ul>
    <p>
      WebBites starts again by itself after a restart of the computer, as long as Docker does (Docker Desktop
      has a setting to start when you log in).
    </p>
  </section>

  <section>
    <h2 id="updating">Updating</h2>
    <p>
      When a release is out, click <strong>Update</strong> on the banner (or <strong>Update to x.y.z…</strong>
      in the menu). The app downloads the new release's files, keeping the old ones in
      <code>.previous</code> in the folder, downloads the new version and restarts WebBites. Your bookmarks,
      settings and <code>.env</code> are left as they are, and any data upgrades run on their own.
    </p>
    <p>
      Back up first, especially across a major version: see
      <NuxtLink to="/developers/docs/self-hosting-operations#backups">backups and restore</NuxtLink>. The app
      itself updates by downloading the new one from the
      <a :href="RELEASES_URL" target="_blank" rel="noopener">latest release</a>.
    </p>
  </section>

  <section>
    <h2 id="stopping">Stopping, moving and removing</h2>
    <ul>
      <li><strong>Stop</strong> turns WebBites off; nothing is deleted. <strong>Start</strong> brings it back as it was.</li>
      <li><strong>Another install</strong> (in Settings) switches the app to a different folder. Each folder is its own WebBites.</li>
      <li>
        <strong>To remove WebBites and everything in it</strong>, stop it, then in its folder run
        <code>docker compose down -v</code> and delete the folder. <code>-v</code> deletes the data, so back up
        first if you may want it. Then delete the app.
      </li>
    </ul>
  </section>

  <section>
    <h2 id="safety">Safety</h2>
    <ul>
      <li>The setup page only answers this computer (<code>127.0.0.1</code>), on a random port, and only with a new random key each time the app opens it. Other websites in your browser can't reach it.</li>
      <li>An old or copied link shows <em>Open WebBites Server from its menu</em> instead of the page. Open it from the menu again.</li>
      <li>It runs <code>docker compose</code> in the WebBites folder, and nothing else.</li>
      <li>The secrets in <code>.env</code> are generated on your computer and never leave it.</li>
    </ul>
  </section>

  <section>
    <h2 id="troubleshooting">If something goes wrong</h2>
    <ul>
      <li><strong>Docker is not running</strong>: open Docker Desktop (or <code>sudo systemctl start docker</code> on Linux) and wait for it to finish starting.</li>
      <li><strong>The download failed</strong>: check your internet connection and try again. Nothing was started, so there is nothing to clean up.</li>
      <li><strong>A part says Having trouble</strong>: look at its logs in the Logs tab, then try <strong>Restart</strong> in Settings.</li>
      <li><strong>Your domain doesn't open</strong> (server installs): check that its DNS points at this server and that ports 80 and 443 are open in the firewall. The certificate arrives a minute or so after the domain first reaches the server.</li>
      <li>Still stuck? <a :href="ISSUES_URL" target="_blank" rel="noopener">Open an issue</a> with the log from <strong>Show details</strong> or the Logs tab.</li>
    </ul>
    <p>
      Next: <NuxtLink to="/developers/docs/self-hosting-operations">configuration, backups and upgrades</NuxtLink>.
    </p>
  </section>
</template>

<script setup>
import { SELF_HOST_REPO_URL, SELF_HOST_RELEASES_URL as RELEASES_URL, SELF_HOST_DOWNLOAD_URL as DOWNLOAD, SELF_HOST_SHOTS } from '~/utils/devApi'

const ISSUES_URL = `${SELF_HOST_REPO_URL}/issues`

// Pixel sizes, so the page doesn't jump while the screenshots load.
const SIZES = {
  docker: [1200, 921], where: [1200, 1139], 'details-computer': [1200, 1620], 'details-server': [1200, 1113],
  installing: [1200, 880], failed: [1200, 941], ready: [1200, 843], home: [1200, 1689], logs: [1200, 1243],
  settings: [1200, 1634],
}
const shot = (name) => ({
  src: `${SELF_HOST_SHOTS}/${name}.webp`,
  width: SIZES[name][0],
  height: SIZES[name][1],
  loading: 'lazy',
  decoding: 'async',
})

const DOWNLOADS = [
  { os: 'macOS', detail: '11 or newer, Apple silicon and Intel', files: [{ label: 'Universal (.zip)', file: 'WebBites-Server-macOS.zip' }], then: 'Unzip it and move WebBites Server to Applications.' },
  { os: 'Windows', detail: '10 or 11, x64 or Arm', files: [{ label: 'x64 (.zip)', file: 'WebBites-Server-windows-amd64.zip' }, { label: 'Arm (.zip)', file: 'WebBites-Server-windows-arm64.zip' }], then: 'Unzip it and run WebBites Server.exe.' },
  { os: 'Linux', detail: 'x64 or Arm, with a desktop', files: [{ label: 'x64 (.tar.gz)', file: 'WebBites-Server-linux-amd64.tar.gz' }, { label: 'Arm (.tar.gz)', file: 'WebBites-Server-linux-arm64.tar.gz' }], then: 'Unpack it and run webbites-server. A .desktop file is included for your launcher.' },
]

const PARTS = [
  { label: 'Web server', name: 'caddy', role: 'Answers on the network and handles HTTPS.' },
  { label: 'App', name: 'web', role: 'The WebBites web app.' },
  { label: 'Engine', name: 'api', role: 'Saving, search, background jobs, the API and MCP.' },
  { label: 'Accounts & data', name: 'parse', role: 'Accounts, data, live updates and files.' },
  { label: 'Database', name: 'mongo', role: 'Where everything is stored.' },
  { label: 'Queue', name: 'redis', role: 'Background jobs, rate limits and API keys.' },
  { label: 'Search', name: 'meilisearch', role: 'Search.' },
  { label: 'Page previews', name: 'screenshot', role: 'Screenshots of saved pages. Only with page previews on.' },
  { label: 'File storage', name: 'rustfs', role: 'Uploads. Only with separate file storage on.' },
]
</script>
