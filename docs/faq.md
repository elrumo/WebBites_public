# FAQ

**What is different from WebBites.io?** The app is the same. A self-hosted install has no payment plans:
no limits, every feature on. There is no marketing site; `/` goes to sign-in. Email, AI, screenshots
and search run on services you provide.

**Is WebBites.io still a thing?** Yes: the paid hosted service. It runs this code plus a private layer
for Stripe and App Store billing.

**Will my data or URLs go to WebBites.io?** No. Nothing in these images contacts it.

**What does it cost to run?** A small VPS: 2 GB RAM without screenshots, about 3 GB with. AI calls cost
whatever your endpoint costs (or nothing with a local model).

**License?** AGPL-3.0. If you modify WebBites and offer it to other people over a network, you must
offer them your modified source.

**What is missing?**
- Invite-only sign-ups (anyone who can reach the server can register).
- An importer for boards and tags from a WebBites.io backup.
- Multi-instance Parse. One instance is plenty for a team.
- Native apps and the extension work against your server only with a custom-server setting
  (see [clients](clients.md)).

**Where do I report bugs?** The GitHub issues of this repository.
