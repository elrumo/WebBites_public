# Install from the terminal

Install on a server with one command, by hand with compose.yaml, from a clone, or with the webbites-server command.

## Which way

Four ways in, all ending in the same place: a folder with the compose setup and an `.env` of fresh secrets, running in Docker. Pick by where WebBites will run.

| Way | Best for | Upgrade by |
|---|---|---|
| [One command](https://www.webbites.io/developers/docs/self-hosting-terminal#one-command) | A Linux server or VPS over SSH. The quickest. | Running the same command again |
| [The `webbites-server` command](https://www.webbites.io/developers/docs/self-hosting-terminal#cli) | A server you also want to start, stop, update and read logs on with short commands. | `webbites-server update` |
| [By hand with `compose.yaml`](https://www.webbites.io/developers/docs/self-hosting-terminal#by-hand) | Seeing every line, or fitting WebBites into a setup you already have. | Downloading the file again, then `docker compose pull` |
| [From a clone](https://www.webbites.io/developers/docs/self-hosting-terminal#from-a-clone) | Following the code, or contributing. | `git pull` |

On your own Mac, PC or Linux desktop, the [WebBites Server app](https://www.webbites.io/developers/docs/self-hosting-app) does all of this without a terminal.

## One command

On a machine with Docker, run:

```bash
curl -fsSL https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh | sh
```

It downloads only the deployment files of the latest release into `./webbites` (no clone, nothing to build), asks a few questions, writes `.env` with fresh secrets, pulls the images and starts WebBites. The questions:

1. **Domain**: your domain, such as `bookmarks.example.com`, for HTTPS from anywhere. Or `localhost` to try it on this machine.
2. **Email**: only an account with this address can become the administrator. Leave it empty and the first account to sign up does.
3. **Page previews**: the screenshot service, about 1 GB of memory.
4. **Separate file storage**: a bundled S3 store for uploads instead of the database.

Give the answers up front to skip the questions, for a script or a provisioning tool:

```bash
curl -fsSL https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh \
  | sh -s -- --domain bookmarks.example.com --email you@example.com --yes
```

| Option | Does |
|---|---|
| `--domain <name>` | Your domain, or localhost. |
| `--email <address>` | The only address that can become the administrator. |
| `--http-port <port>` | For localhost: the port to use if 80 is taken (for example 8080). |
| `--no-screenshots` | No page previews; saves about 1 GB of memory. |
| `--rustfs` | Keep uploads in the bundled S3 store. |
| `--yes` | Ask nothing; use the answers given and the defaults. |
| `--dir <folder>` | Where WebBites lives (default ./webbites). |
| `--version <x.y.z>` | A specific release instead of the latest. |
| `--no-start` | Set up or upgrade the files only; start later with docker compose up -d. |

**To upgrade**, run the same command again in the same place. The deployment files are replaced by the new release's (the old ones are kept in `webbites/.previous`), and `.env` is kept with its `WEBBITES_VERSION` moved on.

> Want to read it before running it? It is short: [deploy/get.sh](https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh). Or download it first: `curl -fsSLO https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh`, read it, then `sh get.sh`.

## The `webbites-server` command

The [WebBites Server app](https://www.webbites.io/developers/docs/self-hosting-app) is also a command-line tool, so a server without a desktop can use it too. Download it for Linux:

```bash
# x64 servers; use linux-arm64 on Arm
curl -fsSL https://github.com/elrumo/webbites_public/releases/latest/download/WebBites-Server-linux-amd64.tar.gz | tar xz
sudo install WebBites-Server-linux-amd64/webbites-server /usr/local/bin/
```

Then:

```bash
webbites-server install          # the same questions (or --domain ... --email ... --yes)
webbites-server status           # running? which version, which address
webbites-server update           # to the latest release (--version x.y.z for another)
webbites-server start | stop | restart
webbites-server logs api -f      # one part's logs: web, api, parse, mongo, ...
webbites-server ui               # the setup page, through an SSH tunnel
```

Every command takes `--dir <folder>`; the default is the folder used last, or `~/WebBites`. It manages installs made the other ways too: point it at their folder.

`webbites-server ui` starts the same setup page as the app, on `127.0.0.1` only. From your own computer, reach it through an SSH tunnel to the port it prints:

```bash
ssh -L 8765:127.0.0.1:<port> you@your-server
# then open the address it printed, with 8765 in place of its port
```

## By hand with compose.yaml

Make a folder, download `compose.yaml` into it and write a `.env` next to it with your address and fresh secrets. Change `PUBLIC_URL` to your domain first, or use `http://localhost` to try it on one machine.

```bash
mkdir webbites && cd webbites
curl -fsSLO https://www.webbites.io/self-hosting/compose.yaml

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

docker compose up -d
```

That is the whole install. `compose.yaml` is the setup, the same for everyone: read it at https://www.webbites.io/self-hosting/compose.yaml. `.env` holds what is yours: the address and the secrets. Keep it private and back it up; upgrading replaces `compose.yaml` and never touches it. Email, AI, file storage and the rest are set from the admin page, so they are not in the file.

The images are published on Docker Hub as `elrumo/webbites-web`, `elrumo/webbites-api`, `elrumo/webbites-parse` and `elrumo/webbites-screenshot`, for both `amd64` and `arm64`.

## From a clone

```bash
git clone https://github.com/elrumo/webbites_public.git
cd webbites_public/deploy
./install.sh            # or: ./install.sh --domain bookmarks.example.com --email you@example.com --yes
docker compose pull
docker compose up -d
```

`install.sh` asks the same questions as the one-line installer, takes the same options, and never overwrites an existing `.env`. To upgrade, `git pull`, then `docker compose pull` and `docker compose up -d` in `deploy/`.

## Then

Open the address it prints and **create your account straight away**: the first account becomes the administrator. See [Claim the install](https://www.webbites.io/developers/docs/self-hosting#first-account), then [configuration, backups and upgrades](https://www.webbites.io/developers/docs/self-hosting-operations).
