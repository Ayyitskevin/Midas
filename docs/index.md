# Midas

A self-hosted, open-source **crypto terminal** — the Bloomberg-style command
grammar (`SYMBOL FUNCTION`), tiling panels, and honest data, running on your
own box for free, forever.

> `BTC/USDT GP` → chart. `BTC/USDT BOOK` → order book. `ALERT`, `SCREEN`,
> `PORT`, `TICKET`… ~130 commands, ~115 analytics boards. Press **⌘K**.

## Start here

- **[Open the live demo](https://ayyitskevin.github.io/Midas/demo/)** — the
  real terminal against a synthetic in-browser market. No server, no signup;
  everything labeled honestly.
- **Run it in 2 minutes** — [README quickstart](https://github.com/Ayyitskevin/Midas#quickstart):
  `docker compose up -d`, open `http://localhost:8080`. The default `mock`
  provider works offline; flip `MIDAS_DATA_PROVIDER=ccxt` for live markets.
- **Every configuration flag** — the [README environment reference](https://github.com/Ayyitskevin/Midas#configuration)
  is the single source of truth for env vars (provider, auth, alerts,
  account keys, trading gates, caps, demo mode).
- **Security model** — [SECURITY.md](https://github.com/Ayyitskevin/Midas/blob/main/SECURITY.md):
  non-custodial by design, read-only by default, trading strictly opt-in
  behind defense in depth, per-user keys encrypted at rest.

## Guides in this site

- **[Hosted beta runbook](HOSTED_BETA.md)** — provision a managed instance
  for beta users: hardened env, per-user keys, caps, load-testing, and the
  invite email.
- **[Architecture](ARCHITECTURE.md)** — the monorepo, the provider seam,
  the data-honesty rules, and how a panel comes to exist.
- **[Per-user keys design](HOSTED_KEYS_DESIGN.md)** — the multi-tenant key
  model: encrypted storage, provider pool, the reads-account = writes-account
  rule, per-user loops.
- **[Roadmap](ROADMAP.md)** — where this is going, honestly checkmarked.

## Principles (the short version)

1. **Data honesty.** Synthetic, delayed or unavailable data is always labeled;
   a gap is truthful, a made-up point is a bug.
2. **Non-custodial.** Midas never holds funds and has no withdrawal code path.
   Reads by default; the only writes are placing/canceling an order you
   explicitly enabled, capped and audited.
3. **Self-hosting stays free.** The hosted tier (waitlist) pays for the
   convenience, not the software.
