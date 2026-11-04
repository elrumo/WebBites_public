# Contributing

Thanks for helping. A few ground rules:

- Open an issue before a large change.
- Keep changes focused; add or update tests next to the code (`apps/api/server/utils/*.test.ts`,
  `apps/parse/test/*.test.js`).
- Do not add telemetry, analytics or calls to third-party services that are on by default. Anything that
  leaves the server must be opt-in and configured by the person running it.
- Do not commit credentials. `.env` files are ignored; use `.env.example` for documented defaults.

Contributions are accepted under the project's license (AGPL-3.0-only). The maintainer may ask contributors
to sign a contributor license agreement before merging larger changes.
