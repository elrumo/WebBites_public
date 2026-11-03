# Backups and restore

## What holds state

| Volume | Holds | If lost |
|---|---|---|
| `mongo_data` | Accounts, bookmarks, boards, notes, settings, and files (unless you use S3) | Everything is gone |
| `redis_data` | Developer API keys (`wb_live_...`), queued jobs, short-lived tokens | API keys stop working (users create new ones); queued jobs are lost |
| `rustfs_data` or your bucket | Files, if you chose S3 | Images and attachments are gone |
| `meili_data` | Search index | Nothing: rebuild it (Admin → Search index → Sync now) |
| `caddy_data` | HTTPS certificates | Re-issued automatically |
| `.env` | Every secret | Encrypted settings and backups cannot be read; accounts need new keys |

## Back up

The three that matter, while the stack runs:

```sh
cd deploy
set -a; . ./.env; set +a
STAMP=$(date +%F)

# MongoDB (a consistent dump)
docker compose exec -T mongo mongodump -u webbites -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --archive --gzip > "mongo-$STAMP.archive.gz"

# Redis: save, then copy the append-only file out
docker compose exec -T redis redis-cli SAVE
docker run --rm -v webbites_redis_data:/data -v "$PWD":/out alpine tar czf "/out/redis-$STAMP.tgz" -C /data .

# The secrets
cp .env "env-$STAMP.backup" && chmod 600 "env-$STAMP.backup"
```

Volume names are prefixed with the compose project name (`webbites_` here; see `docker volume ls`).
With RustFS, also copy `rustfs_data`; with your own bucket, use the provider's versioning or sync.
Keep backups somewhere that is not this machine. They contain everything, including users' data: encrypt
them.

## Restore

On a fresh install (or after deleting the volumes), with the original `.env` in place:

```sh
docker compose up -d mongo redis
docker compose exec -T mongo mongorestore -u webbites -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --archive --gzip --drop < mongo-2025-01-01.archive.gz

docker compose stop redis
docker run --rm -v webbites_redis_data:/data -v "$PWD":/in alpine sh -c 'rm -rf /data/* && tar xzf /in/redis-2025-01-01.tgz -C /data'
docker compose up -d
```

Then open **Admin → Search index → Sync now** to rebuild search.

Test a restore once, on a spare machine, before you need it.

## Users' own backups

Per-user backups (Settings → Backups) write zip files to a destination each user connects
(S3, Dropbox, Google Drive). They are for users to keep their own bookmarks, not for you to restore a
server from.
