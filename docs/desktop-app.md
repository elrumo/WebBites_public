# WebBites Server (the desktop app)

A small app that installs and runs WebBites with Docker, without a terminal. It is one file for
macOS, Windows and Linux, and does what `deploy/get.sh` and `deploy/install.sh` do.

## Install

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine on
   Linux) and start it.
2. Download WebBites Server from the [latest release](https://github.com/elrumo/webbites_public/releases/latest):
   - **macOS:** `WebBites-Server-macOS.zip`. Unzip it and move **WebBites Server** to Applications.
     If macOS says it can't check the app, right-click it and choose **Open** the first time.
   - **Windows:** `WebBites-Server-windows-amd64.zip` (or `-arm64`). Unzip and run **WebBites Server.exe**.
   - **Linux:** `WebBites-Server-linux-amd64.tar.gz` (or `-arm64`). Unpack it and run `webbites-server`.
     For a launcher, copy `webbites-server.desktop` to `~/.local/share/applications/`, and the binary
     and icon somewhere on your `PATH` and icon path.
3. Open it. The first time, it opens its setup page in your browser:
   - **Folder:** where WebBites keeps its settings (`~/WebBites` by default).
   - **On this computer** (http://localhost, with a port of your choice if 80 is taken) or **on a server
     with my domain** (HTTPS, certificate included).
   - Your email (optional): only that address can become the administrator.
   - Screenshots (about 1 GB of RAM) and the bundled S3 file store.
4. **Install** downloads the images (a few minutes the first time) and starts WebBites. Open it and
   create your account: the first one becomes the administrator.

## Every day

The icon in the menu bar (notification area) shows whether WebBites is running, and has **Open
WebBites**, **Start**, **Stop**, **Update to x.y.z** when a release is out, **Settings and logs**, and
**Show folder**. Quitting the app leaves WebBites running: it lives in Docker, not in the app.

**Back up the `.env`** in the folder: it holds the keys your data is encrypted with. See [backups](backups.md).

## On a server (no desktop)

The same binary is a command-line tool:

```sh
webbites-server install            # asks the same questions (or --domain ... --email ... --yes)
webbites-server status             # running? which version, which address
webbites-server update             # to the latest release (--version x.y.z for another)
webbites-server start | stop | restart
webbites-server logs api -f
webbites-server ui                 # the setup page; reach it through an SSH tunnel
```

Every command takes `--dir <folder>`. Without a desktop, `webbites-server` with no command starts the
setup page and prints its address.

## Safety

The setup page listens on `127.0.0.1` only, on a random port, and answers only with the random key in
the address the app opens. Other websites in your browser can't reach it. It runs `docker compose` in the
WebBites folder and nothing else.
