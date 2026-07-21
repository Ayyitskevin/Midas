# Midas

A self-hosted, open-source **crypto terminal** — the Bloomberg-style command
grammar (`SYMBOL FUNCTION`), tiling panels, and honest data, running on your
own box for free, forever.

> `BTC/USDT GP` → chart. `BTC/USDT BOOK` → order book. `ALERT`, `SCREEN`,
> `PORT`, `TICKET`… ~130 commands, ~115 analytics boards. Press **⌘K**.

## Start here

- **Review the static demo locally** — run `pnpm reviewer:demo` from the
  repository for the real terminal against a synthetic in-browser market. No
  server, no signup; everything labeled honestly. Public Pages deployment is
  still awaiting the one-time maintainer setup in the
  [maintenance playbook](MAINTENANCE.md).
- **Run it in 2 minutes** — [README quickstart](https://github.com/Ayyitskevin/Midas#quickstart):
  `docker compose up -d`, open `http://localhost:8080`. The default `mock`
  provider works offline; flip `MIDAS_DATA_PROVIDER=ccxt` for live markets.
- **Every configuration flag** — the [README environment reference](https://github.com/Ayyitskevin/Midas#configuration)
  is the single source of truth for env vars (provider, auth, alerts,
  account keys, execution hold, and demo mode).
- **Security model** — [SECURITY.md](https://github.com/Ayyitskevin/Midas/blob/main/SECURITY.md):
  non-custodial by design, read-only account access, execution held fail-closed,
  and per-user keys encrypted at rest.

## Guides in this site

- **[Self-hosting for a team](HOSTED_BETA.md)** — run a shared multi-user
  instance: hardened env, per-user keys, caps, load-testing, and the invite
  email.
- **[Architecture](ARCHITECTURE.md)** — the monorepo, the provider seam,
  the data-honesty rules, and how a panel comes to exist.
- **[Execution safety hold](EXECUTION_SAFETY_HOLD.md)** — current posture,
  root causes, and the complete re-enable gate.
- **[Per-user keys design](HOSTED_KEYS_DESIGN.md)** — the multi-tenant key
  model: encrypted storage, provider pool, the reads-account = writes-account
  rule, per-user loops.
- **[Roadmap](ROADMAP.md)** — where this is going, honestly checkmarked.
- **[Reviewer guide](REVIEWER-GUIDE.md)** — a disposable demo path, code-tour
  seams, and questions worth challenging in review.
- **[AI-assisted development policy](AI-DEVELOPMENT.md)** — evidence and data
  boundaries for agent-authored changes and the optional copilot.

## Principles (the short version)

1. **Data honesty.** Synthetic, delayed or unavailable data is always labeled;
   a gap is truthful, a made-up point is a bug.
2. **Non-custodial.** Midas never holds funds and has no withdrawal code path.
   Account access is read-only; placement and in-app cancellation fail closed
   under the execution safety hold.
3. **Free and open source.** Every panel and board, no accounts and no paid
   tier — self-host it or run the static demo locally. Optional shared hosting
   for a team stays free too.

- [Game plan (post-main restore)](GAMEPLAN.md)
