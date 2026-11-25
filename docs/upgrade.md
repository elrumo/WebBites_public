# Upgrading

Images are tagged with the release version. `.env` has `WEBBITES_VERSION` (the installers pin it to the
release they installed).

**Installed with the one-line command?** Run it again in the same place: it fetches the new release's
deployment files (keeping the old ones in `.previous/`), moves `WEBBITES_VERSION` on, pulls and restarts.

```sh
curl -fsSL https://raw.githubusercontent.com/elrumo/webbites_public/master/deploy/get.sh | sh
```

**With the WebBites Server app?** Choose **Update to x.y.z** in its menu (or `webbites-server update`).

**By hand** (a clone):

```sh
cd deploy
git pull                      # new docker-compose.yml / Caddyfile, if the release changed them
docker compose pull
docker compose up -d
```

Compose recreates only containers whose image changed. Parse and the API run any data upgrades they need
when they start.

- **Pin versions.** Set `WEBBITES_VERSION=1.2.3` so a restart never pulls something new by surprise, and
  bump it deliberately.
- **Back up first** ([backups](backups.md)), especially across a major version.
- **Read the release notes** for changes to `.env` or `docker-compose.yml`; new settings usually have defaults.
- **Roll back** by setting the previous `WEBBITES_VERSION` and running `docker compose up -d`. If the new
  version changed the data format, restore the backup you took.
- **Keep the project name.** Docker names containers and volumes after the Compose project (`webbites`, or
  `COMPOSE_PROJECT_NAME` in `.env` when a second install shares the machine). Changing it on a running install
  starts a new, empty set of volumes and leaves your data behind under the old name.
- The `meilisearch` image is pinned to a version in `docker-compose.yml`. Moving to a new Meilisearch
  version needs the index dumped or rebuilt; follow Meilisearch's upgrade notes, or delete `meili_data`
  and run **Admin → Search index → Sync now**.
