# The WebBites Server app

Install and run WebBites on your Mac, PC or Linux desktop without a terminal: download, set up step by step, start, stop and update.

## What it is

WebBites Server is a small app for macOS, Windows and Linux that sets WebBites up with Docker and then runs it for you. No terminal, no files to edit: it asks a couple of questions in your browser and does the rest.

- **It lives in the menu bar** (the notification area on Windows and Linux) and shows whether WebBites is running.
- **It installs, starts, stops and updates** WebBites, and shows what each part is doing.
- **Quitting it leaves WebBites running.** WebBites lives in Docker, not in the app, so you only need the app to change something.

It is the easiest way to run WebBites on your own computer. On a server you reach over SSH, the same file works as a command-line tool: see [Install from the terminal](https://www.webbites.io/developers/docs/self-hosting-terminal).

## Download

Every release has the app attached. Pick the file for your computer from the [latest release](https://github.com/elrumo/webbites_public/releases/latest), or use these links:

| Computer | File | Then |
|---|---|---|
| **macOS** 11 or newer, Apple silicon and Intel | [WebBites-Server-macOS.zip](https://github.com/elrumo/webbites_public/releases/latest/download/WebBites-Server-macOS.zip) | Unzip it and move WebBites Server to Applications. |
| **Windows** 10 or 11, x64 or Arm | [WebBites-Server-windows-amd64.zip](https://github.com/elrumo/webbites_public/releases/latest/download/WebBites-Server-windows-amd64.zip), [WebBites-Server-windows-arm64.zip](https://github.com/elrumo/webbites_public/releases/latest/download/WebBites-Server-windows-arm64.zip) | Unzip it and run WebBites Server.exe. |
| **Linux** x64 or Arm, with a desktop | [WebBites-Server-linux-amd64.tar.gz](https://github.com/elrumo/webbites_public/releases/latest/download/WebBites-Server-linux-amd64.tar.gz), [WebBites-Server-linux-arm64.tar.gz](https://github.com/elrumo/webbites_public/releases/latest/download/WebBites-Server-linux-arm64.tar.gz) | Unpack it and run `webbites-server`. A `.desktop` file is included for your launcher. |

> You also need **Docker**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) on a Mac or PC, or Docker Engine with the Compose plugin on Linux. Install it whenever you like; the app checks for it first and waits until it is running. Plan for 2 GB of free memory, or 3 GB with page previews.

The first time you open an app downloaded from the internet, your computer may ask whether you trust it. On a Mac, if it says it can't check the app, right-click it and choose **Open**. On Windows, if SmartScreen appears, choose **More info → Run anyway**.

## Set it up, step by step

Open WebBites Server. The first time, it opens its setup page in your browser by itself.

### 1. Docker

If Docker is missing or not running, the page says which, and has a button to get it. Install it, open it once, and come back: the page notices on its own and moves on. If Docker is ready, you skip this step.

![The setup page asking for Docker, with three steps and a Get Docker button](https://www.webbites.io/self-hosting/app/docker.webp)

### 2. Where you will use it

![Two choices: On this Mac, or On a server, at my own address](https://www.webbites.io/self-hosting/app/where.webp)

- **On this Mac** (or PC, or computer): WebBites runs on this computer and opens at `http://localhost`. Nothing to configure. Pick this to use it yourself, or to try it.
- **On a server, at my own address**: WebBites answers at your own domain, with HTTPS, from anywhere. Pick this when the app runs on the machine that will serve WebBites, and you have a domain name pointing at it.
- **Open an existing install**: if WebBites is already set up in a folder (by the app, the one-line installer or `install.sh`), point the app at that folder to manage it.

### 3. A few details

![The details form for this computer, with the Advanced options open](https://www.webbites.io/self-hosting/app/details-computer.webp)

![The details form for a server, asking for the domain](https://www.webbites.io/self-hosting/app/details-server.webp)

- **Your domain** (server only), such as `bookmarks.example.com`. Point its DNS record at the server and open ports 80 and 443 first; the HTTPS certificate is then set up for you.
- **Your email**, optional but recommended: only an account with this address can become the administrator. Leave it empty and the first account to sign up does.

Most people never open **Advanced**. It holds:

- **Page previews** (on): screenshots of the pages you save. Uses about 1 GB of memory; turn it off on a small machine.
- **Separate file storage** (off): keeps uploads in a bundled S3 store instead of the database. Better for big libraries.
- **Port** (this computer only): already filled in with one that is free, so it works even if another app uses port 80.
- **Folder**: where WebBites keeps its settings, `~/WebBites` by default. Your bookmarks themselves live in Docker.

### 4. Install

Click **Install WebBites** and the page shows each step as it happens. The first time takes a few minutes, mostly to download WebBites. You can close the page: it keeps going, and the menu shows when it is done.

![Setting things up: four steps, two done, one in progress](https://www.webbites.io/self-hosting/app/installing.webp)

If a step fails, the page says what happened in plain words and whether anything was changed. **Try again** takes you back to your answers. **Show details** has the full log, which is what to paste into an issue.

![That didn't work: the failed step, a plain explanation and a Try again button](https://www.webbites.io/self-hosting/app/failed.webp)

### 5. Create your account

![WebBites is ready, with two things to do next and an Open WebBites button](https://www.webbites.io/self-hosting/app/ready.webp)

1. **Open WebBites and sign up straight away.** The first account becomes the administrator (or the account with your email, if you gave one).
2. **Copy the `.env` file** from the WebBites folder somewhere safe. It holds the keys your data is encrypted with; without it a backup can't be read.

Then, as administrator, open **/admin → Settings** in WebBites to connect email, an AI endpoint and the rest.

## Every day

Open the setup page again from the menu, with **Settings and logs…**, to see how WebBites is doing. At the top: whether it is running, its version and address, **Open WebBites** and **Start** or **Stop**. When a new release is out, a banner offers it.

![WebBites Server home: an update banner, Running, the address, Open WebBites, Stop and the list of services](https://www.webbites.io/self-hosting/app/home.webp)

### Overview

Each part of WebBites, with a plain name and its state (Healthy, Starting…, Having trouble, Stopped):

| In the app | Container | Does |
|---|---|---|
| Web server | `caddy` | Answers on the network and handles HTTPS. |
| App | `web` | The WebBites web app. |
| Engine | `api` | Saving, search, background jobs, the API and MCP. |
| Accounts & data | `parse` | Accounts, data, live updates and files. |
| Database | `mongo` | Where everything is stored. |
| Queue | `redis` | Background jobs, rate limits and API keys. |
| Search | `meilisearch` | Search. |
| Page previews | `screenshot` | Screenshots of saved pages. Only with page previews on. |
| File storage | `rustfs` | Uploads. Only with separate file storage on. |

### Logs

The latest lines from everything, or from one part. When something misbehaves, this is where to look, and what to paste into an issue.

![The Logs tab: a button per part and the latest log lines](https://www.webbites.io/self-hosting/app/logs.webp)

### Settings

The address and folder (with **Show** to open it), a reminder about backups, **Restart**, **Another install** to manage WebBites in a different folder, and the versions of WebBites and of the app.

![The Settings tab: address, folder, backups, restart, another install and version](https://www.webbites.io/self-hosting/app/settings.webp)

### The menu

Everything day to day is also in the menu-bar icon:

- **Running · 0.7.0** (or Stopped, or Docker is not running): the state at a glance.
- **Open WebBites**: your WebBites in the browser.
- **Start** and **Stop**.
- **Update to x.y.z…**, only when a release is out. It opens the page, which asks before updating.
- **Settings and logs…** and **Show folder**.
- **Quit WebBites Server**: closes the app; WebBites keeps running.

WebBites starts again by itself after a restart of the computer, as long as Docker does (Docker Desktop has a setting to start when you log in).

## Updating

When a release is out, click **Update** on the banner (or **Update to x.y.z…** in the menu). The app downloads the new release's files, keeping the old ones in `.previous` in the folder, downloads the new version and restarts WebBites. Your bookmarks, settings and `.env` are left as they are, and any data upgrades run on their own.

Back up first, especially across a major version: see [backups and restore](https://www.webbites.io/developers/docs/self-hosting-operations#backups). The app itself updates by downloading the new one from the [latest release](https://github.com/elrumo/webbites_public/releases/latest).

## Stopping, moving and removing

- **Stop** turns WebBites off; nothing is deleted. **Start** brings it back as it was.
- **Another install** (in Settings) switches the app to a different folder. Each folder is its own WebBites.
- **To remove WebBites and everything in it**, stop it, then in its folder run `docker compose down -v` and delete the folder. `-v` deletes the data, so back up first if you may want it. Then delete the app.

## Safety

- The setup page only answers this computer (`127.0.0.1`), on a random port, and only with a new random key each time the app opens it. Other websites in your browser can't reach it.
- An old or copied link shows *Open WebBites Server from its menu* instead of the page. Open it from the menu again.
- It runs `docker compose` in the WebBites folder, and nothing else.
- The secrets in `.env` are generated on your computer and never leave it.

## If something goes wrong

- **Docker is not running**: open Docker Desktop (or `sudo systemctl start docker` on Linux) and wait for it to finish starting.
- **The download failed**: check your internet connection and try again. Nothing was started, so there is nothing to clean up.
- **A part says Having trouble**: look at its logs in the Logs tab, then try **Restart** in Settings.
- **Your domain doesn't open** (server installs): check that its DNS points at this server and that ports 80 and 443 are open in the firewall. The certificate arrives a minute or so after the domain first reaches the server.
- Still stuck? [Open an issue](https://github.com/elrumo/webbites_public/issues) with the log from **Show details** or the Logs tab.

Next: [configuration, backups and upgrades](https://www.webbites.io/developers/docs/self-hosting-operations).
