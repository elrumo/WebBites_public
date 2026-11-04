# File storage

Uploaded files, screenshots and saved pages need somewhere to live.

| Option | Choose it when |
|---|---|
| **MongoDB (GridFS)**, default | A personal or small-team install. Nothing extra to run or back up. |
| **RustFS** (`--rustfs` in the installer) | You want object storage in the same compose file. |
| **Any S3 bucket** (AWS, Backblaze B2, Cloudflare R2, MinIO, Garage...) | You already have one, or want files off the server. |

## RustFS

`./install.sh --rustfs` turns on the `rustfs` profile and fills in `FILES_DRIVER=s3`, the endpoint
(`http://rustfs:9000`), a bucket (`webbites`) and the public address (`https://your.domain/s3/webbites`,
which Caddy forwards to RustFS). A one-shot container creates the bucket and makes objects readable by
their URL: that is how browsers load images, so file names are long random strings, not secrets.

> The RustFS image and settings are not exercised by this repository's automated tests. Pin an image
> tag you have tried in `docker-compose.yml` before relying on it.

## Your own S3 bucket

Settings → File storage (or the `S3_*` variables): bucket, endpoint, region, access key, secret key and
the **public address**: where browsers fetch files from (for example a CDN domain in front of the
bucket). The bucket must allow anonymous reads of objects, or sit behind something that does.

## Changing your mind later

File addresses are saved inside your bookmarks. Switching stores does not move anything: files uploaded
before the switch keep pointing at the old place. Copy the old files across (same object names) before
switching, or keep the old store online.
