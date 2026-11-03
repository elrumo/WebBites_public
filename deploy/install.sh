#!/usr/bin/env sh
# WebBites installer: checks Docker, asks a few questions, writes .env with freshly generated
# secrets and tells you how to start. Safe to re-run: it never overwrites an existing .env.
#
#   ./install.sh                         ask questions
#   ./install.sh --domain notes.example.com --yes
#
# Options:
#   --domain <host>      public hostname (default: localhost, plain http, for trying it out)
#   --email <address>    contact address for Let's Encrypt, and makes that person the only
#                        account allowed to become the administrator
#   --rustfs             keep files in the bundled S3-compatible store instead of MongoDB
#   --no-screenshots     don't run the screenshot service
#   --yes                accept defaults, ask nothing
#   --help
set -eu

DOMAIN=""
EMAIL=""
RUSTFS=""
SCREENSHOTS="yes"
ASSUME_YES=""

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --email) EMAIL="${2:?--email needs a value}"; shift 2 ;;
    --rustfs) RUSTFS="yes"; shift ;;
    --no-screenshots) SCREENSHOTS="no"; shift ;;
    --yes|-y) ASSUME_YES="yes"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# ---- prerequisites ----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "'docker compose' (Compose v2) is not available. See https://docs.docker.com/compose/install/"

for f in docker-compose.yml Caddyfile .env.example; do
  [ -f "$f" ] || die "$f not found next to install.sh. Run it from the deploy/ folder of a WebBites release."
done

if [ -f .env ]; then
  say ".env already exists, leaving it alone."
  say "To start over, move it away (mv .env .env.old) and run this again."
  say "Start WebBites with:  docker compose up -d"
  exit 0
fi

# ---- helpers ----------------------------------------------------------------------------------
# $1 = number of random bytes; prints lowercase hex.
rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -vtx1 | tr -d ' \n'
  fi
}

ask() { # $1 prompt, $2 default -> answer on stdout
  if [ -n "$ASSUME_YES" ] || [ ! -t 0 ]; then printf '%s' "$2"; return; fi
  printf '%s [%s]: ' "$1" "$2" >&2
  read -r reply || reply=""
  printf '%s' "${reply:-$2}"
}

ask_yes_no() { # $1 prompt, $2 default (yes|no)
  if [ -n "$ASSUME_YES" ] || [ ! -t 0 ]; then printf '%s' "$2"; return; fi
  printf '%s [%s]: ' "$1" "$2" >&2
  read -r reply || reply=""
  case "${reply:-$2}" in y|Y|yes|YES) printf yes ;; *) printf no ;; esac
}

# ---- questions --------------------------------------------------------------------------------
[ -n "$DOMAIN" ] || DOMAIN="$(ask 'Domain name (use localhost to just try it)' localhost)"
case "$DOMAIN" in
  http://*|https://*) die "Give the host name only, for example notes.example.com (no http://)." ;;
  */*|*" "*) die "That doesn't look like a host name: $DOMAIN" ;;
esac

if [ "$DOMAIN" = "localhost" ]; then
  PUBLIC_URL="http://localhost"
  SITE_ADDRESS="http://localhost"
else
  PUBLIC_URL="https://$DOMAIN"
  SITE_ADDRESS="$DOMAIN"
fi

[ -n "$EMAIL" ] || EMAIL="$(ask 'Your email (for the HTTPS certificate and as the administrator; leave empty to skip)' '')"
if [ -z "$RUSTFS" ]; then
  RUSTFS="$(ask_yes_no 'Keep files in a bundled S3 store (RustFS) instead of MongoDB?' no)"
fi
if [ "$SCREENSHOTS" = "yes" ]; then
  SCREENSHOTS="$(ask_yes_no 'Run the screenshot service (needs about 1 GB of RAM)?' yes)"
fi

PROFILES=""
add_profile() { PROFILES="${PROFILES:+$PROFILES,}$1"; }
[ "$SCREENSHOTS" = "yes" ] && add_profile screenshots
[ "$RUSTFS" = "yes" ] && add_profile rustfs

RUSTFS_ACCESS_KEY="$(rand_hex 10)"
RUSTFS_SECRET_KEY="$(rand_hex 24)"

# ---- write .env -------------------------------------------------------------------------------
umask 077
{
  cat <<EOF
# Written by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep this file private and back it up.

PUBLIC_URL=$PUBLIC_URL
SITE_ADDRESS=$SITE_ADDRESS
HTTP_PORT=80
HTTPS_PORT=443
ACME_EMAIL=$EMAIL
WEBBITES_VERSION=latest
COMPOSE_PROFILES=$PROFILES
INITIAL_ADMIN_EMAIL=$EMAIL

MONGO_PASSWORD=$(rand_hex 24)
PARSE_APP_ID=wb_$(rand_hex 8)
PARSE_JS_KEY=$(rand_hex 24)
PARSE_MASTER_KEY=$(rand_hex 32)
CUSTOM_API_KEY=$(rand_hex 32)
AUDIO_TOKEN_SECRET=$(rand_hex 32)
SHARE_LINK_SECRET=$(rand_hex 32)
BACKUP_ENCRYPTION_KEY=$(rand_hex 32)
SETTINGS_ENCRYPTION_KEY=$(rand_hex 32)
MEILI_MASTER_KEY=$(rand_hex 24)
SCREENSHOT_API_KEY=$(rand_hex 24)
RUSTFS_ACCESS_KEY=$RUSTFS_ACCESS_KEY
RUSTFS_SECRET_KEY=$RUSTFS_SECRET_KEY

APP_NAME=WebBites
EOF
  if [ "$SCREENSHOTS" = "yes" ]; then
    echo "SCREENSHOT_SERVICE_URL=http://screenshot:3000"
  fi
  if [ "$RUSTFS" = "yes" ]; then
    cat <<'EOF'

# Files live in the bundled RustFS (see docker-compose.yml, profile "rustfs").
FILES_DRIVER=s3
S3_BUCKET=webbites
S3_ENDPOINT_URL=http://rustfs:9000
S3_REGION=us-east-1
EOF
    echo "S3_PUBLIC_URL=$PUBLIC_URL/s3/webbites"
    echo "S3_ACCESS_KEY=$RUSTFS_ACCESS_KEY"
    echo "S3_SECRET_KEY=$RUSTFS_SECRET_KEY"
  fi
  cat <<'EOF'

# Email, AI, storage and the other optional settings are described in .env.example.
# Copy any you need from there into this file.
EOF
} > .env

say ""
say "Wrote .env (permissions 600) with new secrets."
say ""
say "Next:"
say "  1. docker compose pull"
say "  2. docker compose up -d"
say "  3. Open $PUBLIC_URL and create your account. The first account becomes the administrator."
say ""
if [ "$DOMAIN" != "localhost" ]; then
  say "Before step 2, point the DNS record for $DOMAIN at this machine and open ports 80 and 443."
  say "Caddy then gets the HTTPS certificate by itself."
  say ""
fi
say "Back up .env: without it your data can't be decrypted or restored."
