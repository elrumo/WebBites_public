#!/bin/sh
# Bridge the deploy env (VITE_*/bare names, shared with the backend and the
# native apps) to the NUXT_* names Nitro reads.
#
# `runtimeConfig` in nuxt.config.ts defaults to `process.env.VITE_*`, but those
# are read at BUILD time and the image is built without any env — so every key
# bakes in as ''. At runtime Nitro only re-reads env vars named after the config
# path with a NUXT_ prefix (NUXT_PUBLIC_PARSE_APP_ID for public.parseAppId), so
# VITE_PARSE_ID sitting in the container is never picked up. Hence: no app id
# ("You need to call Parse.initialize"), no master key, no backend URL.
#
# This has to happen before the server process starts: Nitro snapshots the
# shared runtimeConfig when its config module loads, which is earlier than any
# nitro plugin.
set -e

alias_env() {
  eval "current=\${$1-}"
  if [ -z "$current" ] && [ -n "$2" ]; then
    export "$1=$2"
  fi
}

# Private (server-only)
alias_env NUXT_PARSE_MASTER_KEY "${PARSE_MASTER_KEY-}"
alias_env NUXT_LITELLM_API_KEY "${LITELLM_API_KEY-}"
alias_env NUXT_LITELLM_API_BASE_URL "${LITELLM_API_BASE_URL-}"
alias_env NUXT_LITELLM_TEXT_MODEL "${LITELLM_TEXT_MODEL-}"
alias_env NUXT_LITELLM_TEXT_VENDOR "${LITELLM_TEXT_VENDOR-}"
alias_env NUXT_BACKEND_INTERNAL_URL "${BACKEND_INTERNAL_URL-}"
alias_env NUXT_PARSE_INTERNAL_URL "${PARSE_INTERNAL_URL-}"
alias_env NUXT_APP_URL "${VITE_APP_URL-}"
alias_env NUXT_HELPBITES_PRIVATE_KEY "${HELPBITES_PRIVATE_KEY-}"

# Public (also serialised into the SSR payload for the browser)
alias_env NUXT_PUBLIC_HELPBITES_API_URL "${HELPBITES_API_URL-}"
alias_env NUXT_PUBLIC_HELPBITES_PUBLIC_KEY "${HELPBITES_PUBLIC_KEY-}"
alias_env NUXT_PUBLIC_BACKEND_URL "${VITE_BACKEND_URL-}"
alias_env NUXT_PUBLIC_APP_URL "${VITE_APP_URL-}"
alias_env NUXT_PUBLIC_PARSE_APP_ID "${VITE_PARSE_ID-}"
alias_env NUXT_PUBLIC_PARSE_JS_KEY "${VITE_PARSE_JS_KEY-}"
alias_env NUXT_PUBLIC_PARSE_SERVER_URL "${VITE_PARSE_URL-}"
alias_env NUXT_PUBLIC_PARSE_LIVE_SERVER_URL "${VITE_PARSE_LIVESERVER_URL-}"
alias_env NUXT_PUBLIC_APPLE_APP_ID "${VITE_APPLE_APP_ID-}"
alias_env NUXT_PUBLIC_SELF_HOSTED "${SELF_HOSTED-}"

# The code builds API paths as "${backendUrl}v1/...", so the public and internal API addresses
# both end in a slash.
for var in NUXT_PUBLIC_BACKEND_URL NUXT_BACKEND_INTERNAL_URL; do
  eval "value=\${$var-}"
  case "$value" in
    ""|*/) ;;
    *) export "$var=$value/" ;;
  esac
done

# Fail loudly rather than boot a server that 500s on every SSR render.
missing=""
for var in NUXT_PUBLIC_PARSE_APP_ID NUXT_PUBLIC_PARSE_JS_KEY NUXT_PUBLIC_PARSE_SERVER_URL NUXT_PARSE_MASTER_KEY NUXT_PUBLIC_BACKEND_URL; do
  eval "value=\${$var-}"
  if [ -z "$value" ]; then missing="$missing $var"; fi
done
if [ -n "$missing" ]; then
  echo "FATAL: missing required env (set the source VITE_*/bare names in the deploy env):$missing" >&2
  exit 1
fi

exec bun run .output/server/index.mjs
