#!/bin/sh
# WebBites, self-hosted, with one command and without cloning the repository:
#
#   curl -fsSL https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh | sh
#
# Answers can be given up front (anything not listed below is passed to install.sh):
#
#   curl -fsSL https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh \
#     | sh -s -- --domain notes.example.com --email you@example.com
#
# It downloads only the deployment files of the latest release (docker-compose.yml, Caddyfile,
# install.sh, .env.example) into ./webbites, runs the installer (a few questions, then .env with
# fresh secrets), pulls the images and starts WebBites.
#
# Run it again in the same place to upgrade: the deployment files are replaced by the new release's
# (the old ones are kept in .previous/), .env is kept and its WEBBITES_VERSION moved on.
#
# Options:
#   --dir <path>          where WebBites lives (default: ./webbites, or $WEBBITES_DIR)
#   --version <x.y.z>     a specific release instead of the latest one
#   --no-start            set up or upgrade the files only; start with `docker compose up -d`
#   --help
# install.sh options: --domain, --email, --rustfs, --no-screenshots, --http-port, --yes
#
# The whole script is a function called on the last line, so a download cut short runs nothing.
set -eu

REPO="elrumo/webbites_public"
FILES="docker-compose.yml Caddyfile install.sh .env.example"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

fetch() { # $1 url -> stdout
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    die "Neither curl nor wget is installed."
  fi
}

# The newest release tagged vX.Y.Z. The repository also holds older tags of another form (the old
# macOS app's), which do not match, and pre-releases (vX.Y.Z-rc.N), which are skipped.
latest_version() {
  fetch "https://api.github.com/repos/$REPO/releases?per_page=30" \
    | grep -o '"tag_name": *"v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*"' \
    | head -n 1 \
    | sed 's/.*"v\([^"]*\)"/\1/'
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    say "Docker is not installed."
    case "$(uname -s)" in
      Linux) say "Install it with Docker's own script, then run this again:"
             say "  curl -fsSL https://get.docker.com | sh" ;;
      *)     say "Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, then run this again." ;;
    esac
    exit 1
  fi
  docker compose version >/dev/null 2>&1 \
    || die "'docker compose' (Compose v2) is not available. See https://docs.docker.com/compose/install/"
  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed but this user can't reach it. Start Docker, or run this with sudo (or add yourself to the docker group)."
  fi
}

# Can we ask questions? Piped into sh, stdin is the script itself, so the installer reads the terminal.
have_tty() { [ -t 1 ] && (: </dev/tty) 2>/dev/null; }

main() {
  DIR="${WEBBITES_DIR:-./webbites}"
  VERSION="${WEBBITES_VERSION:-}"
  START="yes"
  PASS=""   # options for install.sh, kept quoted

  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) DIR="${2:?--dir needs a value}"; shift 2 ;;
      --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
      --no-start) START="no"; shift ;;
      --help|-h) sed -n '2,25p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; return 0 ;;
      *) PASS="$PASS '$(printf '%s' "$1" | sed "s/'/'\\\\''/g")'"; shift ;;
    esac
  done
  VERSION="${VERSION#v}"

  check_docker

  if [ -z "$VERSION" ]; then
    VERSION="$(latest_version || true)"
    [ -n "$VERSION" ] || die "Could not find a WebBites release on GitHub. Pass --version x.y.z, or check your connection."
  fi

  # Where the files come from: the release's tag, unless WEBBITES_SOURCE points somewhere else
  # (a branch for testing, or file://... for a local checkout's deploy/ folder).
  SOURCE="${WEBBITES_SOURCE:-https://raw.githubusercontent.com/$REPO/v$VERSION/deploy}"

  mkdir -p "$DIR"
  cd "$DIR"

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  say "Downloading WebBites $VERSION..."
  for f in $FILES; do
    fetch "$SOURCE/$f" > "$TMP/$f" || die "Could not download $f from $SOURCE"
    [ -s "$TMP/$f" ] || die "$f from $SOURCE is empty"
  done

  if [ -f .env ]; then
    # ---- upgrade -------------------------------------------------------------------------------
    FROM="$(sed -n 's/^WEBBITES_VERSION=//p' .env | tail -n 1)"
    say "Upgrading WebBites in $(pwd) from ${FROM:-unknown} to $VERSION. Your .env and data are kept."
    mkdir -p .previous
    for f in $FILES; do [ -f "$f" ] && cp "$f" ".previous/$f"; done
    for f in $FILES; do cp "$TMP/$f" "$f"; done
    chmod +x install.sh
    # Rewritten in place (cat >), so .env keeps its owner and its 600 permissions.
    if grep -q '^WEBBITES_VERSION=' .env; then
      sed "s/^WEBBITES_VERSION=.*/WEBBITES_VERSION=$VERSION/" .env > "$TMP/env" && cat "$TMP/env" > .env
    else
      printf '\nWEBBITES_VERSION=%s\n' "$VERSION" >> .env
    fi
    say "Previous deployment files are in $(pwd)/.previous. New settings, if any, are in .env.example and the release notes."
  else
    # ---- first install -------------------------------------------------------------------------
    for f in $FILES; do cp "$TMP/$f" "$f"; done
    chmod +x install.sh
    if have_tty; then
      eval "sh ./install.sh --version '$VERSION' $PASS" </dev/tty
    else
      eval "sh ./install.sh --version '$VERSION' --yes $PASS"
    fi
    [ -f .env ] || die "install.sh did not write .env"
  fi

  URL="$(sed -n 's/^PUBLIC_URL=//p' .env | tail -n 1)"
  if [ "$START" = "yes" ]; then
    say ""
    say "Pulling the images and starting WebBites (the first time takes a few minutes)..."
    docker compose pull
    docker compose up -d
    say ""
    say "WebBites $VERSION is running: $URL"
    say "Manage it from $(pwd) with docker compose (ps, logs, stop, up -d)."
  else
    say ""
    say "Ready. Start it with:  cd $(pwd) && docker compose pull && docker compose up -d"
    say "Then open $URL"
  fi
}

main "$@"
