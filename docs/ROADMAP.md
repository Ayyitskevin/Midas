# Midas — 30-day roadmap (v2)

The second 30 days: from "feature-complete terminal" to "MicroSaaS people
pay for". The v1 roadmap (order lifecycle, data depth, closing-the-loop
analytics, distribution) shipped in full across v0.2.0–v0.4.0 — see
[CHANGELOG.md](../CHANGELOG.md). This plan optimizes for four things at the
$20–$49 price point: **conversion** (try → deploy → waitlist), **retention**
(the terminal earns its keep weekly), **monetization groundwork** (hosted
tier without breaking self-host), and **scalability** (one operator can run
many users).

## Week 1 — launch essentials (conversion)

- ✅ **Demo mode** (`MIDAS_DEMO_MODE`) — public try-before-you-buy instance,
  safe by construction; banner carries the deploy + waitlist CTAs. *(Shipped)*
- ✅ **First-run tour (`START`)** — teach the grammar by running it. *(Shipped)*
- ✅ **System status (`SYS`)** — "is it on?" without server logs. *(Shipped)*
- ✅ **v0.4.0 release readiness** — changelog, WN entry, version. *(Shipped;
  tag after merge)*
- **Hero screenshot/GIF + public demo VPS** *(operator)* — the two remaining
  launch blockers; `scripts/deploy.sh` + demo mode make the VPS a 10-minute job.
- **Launch**: X thread, Show HN, r/algotrading post.

## Week 2 — monetization groundwork (hosted tier)

- ✅ **Per-user exchange keys, PR 1–2.** *(Shipped)* Encrypted KeyRepo +
  write-only key routes, and the ProviderPool resolving account reads to the
  requesting user's own client. Self-host behavior unchanged; per-user
  background loops and trading remain PR 3 (Week 3).
- **Waitlist → pipeline** — label + triage hosted-waitlist issues; first
  cohort email (size the $20 solo vs $49 desk split from replies).
- ✅ **Rate limiting on public surfaces.** *(Shipped)* Per-IP rpm ceiling
  (`MIDAS_RATE_LIMIT_RPM`), on by default for demo boxes, `/api/health`
  exempt.

## Week 3 — retention (the weekly habit)

- ✅ **Daily P&L recap.** *(Shipped)* The digest leads with equity change and
  adds fills + FIFO round-trip realized P&L and top movers among position
  symbols; `MIDAS_DIGEST_HOURS=24` makes it the morning email.
- ✅ **Alert templates.** *(Shipped)* One-click classics from the ALERT
  panel: funding flip, ±5% day move, 5% equity drawdown.
- ✅ **Workspace share links.** *(Shipped)* ⧉ copies a URL carrying the
  workspace in its fragment; opening imports it as a new workspace. Nothing
  uploaded.
- ✅ **Per-user keys, PR 3.** *(Shipped)* Per-user trading gates (canTrade,
  own client only, never operator fallback), per-user daily budgets +
  idempotency, per-user watcher/equity loops under `MIDAS_MAX_KEYED_USERS`.
  Web KEYS panel is a follow-up (API-first for now).

## Week 4 — scale & polish (worth $49)

- **Hosted tier private beta** — first 5 waitlist users on managed
  instances; $20 solo (1 venue, read+alerts) / $49 desk (2 venues,
  multi-user, trading gates) — billing via Stripe Payment Links first,
  engineering later.
- **Docs site** (mkdocs or plain GitHub Pages from /docs) — searchable
  configuration + panel reference.
- **Performance pass** — bundle budget, server memory profile with 50
  keyed users (from the pool design), load test the demo box.
- **v0.5.0** — release + retro; roadmap v3 from beta feedback.

## Standing invariants (unchanged, non-negotiable)

1. Read-only by default; every write opt-in, capped, confirmed, audited.
2. Data honesty: synthetic/delayed/unavailable is always labeled.
3. Keys never leave the server they were given to; Midas never custodies funds.
4. Self-hosting stays free and full-featured, forever.
5. Every slice lands with tests + the four gates green.
