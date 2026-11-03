# Upgrading

Images are tagged with the release version. `.env` has `WEBBITES_VERSION` (default `latest`).

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
- The `meilisearch` image is pinned to a version in `docker-compose.yml`. Moving to a new Meilisearch
  version needs the index dumped or rebuilt; follow Meilisearch's upgrade notes, or delete `meili_data`
  and run **Admin → Search index → Sync now**.
