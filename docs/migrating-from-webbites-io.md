# Moving from WebBites.io

Your bookmarks can come with you. What moves is limited by what the hosted service can export.

## 1. Export from WebBites.io

In the hosted app: **Settings → Backups → back up now** (or download a backup). The zip it produces holds,
among other files, `bookmarks.html`: every live bookmark in the standard browser bookmarks format.

## 2. Import into your server

Sign in to your install, click **Import**, choose the file `bookmarks.html`. Each address is fetched and
processed again, so titles, summaries, screenshots and search are rebuilt by *your* server. A large library
takes a while (and a lot of AI calls, if you configured an endpoint).

## What does not move

- Boards, tags and notes are in the backup's `boards.json` / `bookmarks.json`, but there is no importer
  for them yet. Only the bookmarks' addresses come across.
- Accounts, passwords, developer API keys, MCP and OAuth connections: create them again.
- Your plan: a self-hosted install has no plans or limits.

## Extension and apps

The browser extension and the iOS and macOS apps talk to WebBites.io unless they are told otherwise;
see [clients](clients.md).
