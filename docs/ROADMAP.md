# Midas — 30-day roadmap (v2)

The second 30 days: from "feature-complete terminal" to "easy to adopt and
share". The v1 roadmap (order lifecycle, data depth, closing-the-loop
analytics, distribution) shipped in full across v0.2.0–v0.4.0 — see
[CHANGELOG.md](https://github.com/Ayyitskevin/Midas/blob/main/CHANGELOG.md). This plan optimizes for three
things: **adoption** (try → deploy → keep it), **retention** (the terminal
earns its keep weekly), and **scalability** (one operator can run a shared
instance for many users) — all while Midas stays free and open source.

## Week 1 — launch essentials (conversion)

- ✅ **Demo mode** (`MIDAS_DEMO_MODE`) — public try-it instance, safe by
  construction; banner carries the deploy-your-own + source CTAs. *(Shipped)*
- ✅ **First-run tour (`START`)** — teach the grammar by running it. *(Shipped)*
- ✅ **System status (`SYS`)** — "is it on?" without server logs. *(Shipped)*
- ✅ **v0.4.0 release readiness** — changelog, WN entry, version. *(Shipped;
  tag after merge)*
- **Hero screenshot/GIF + public demo VPS** *(operator)* — the two remaining
  launch blockers; `scripts/deploy.sh` + demo mode make the VPS a 10-minute job.
- **Launch**: X thread, Show HN, r/algotrading post.

## Week 2 — multi-user groundwork (shared hosting)

- ✅ **Per-user exchange keys, PR 1–2.** *(Shipped)* Encrypted KeyRepo +
  write-only key routes, and the ProviderPool resolving account reads to the
  requesting user's own client. Self-host behavior unchanged; per-user
  background loops and trading remain PR 3 (Week 3).
- **Shared-hosting posture** — the hardened multi-user env (auth, per-user
  keys, caps, rate limits) documented end to end in the self-hosting guide.
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
- ✅ **Per-user account reads.** *(Shipped)* Isolated provider clients plus
  per-user watcher/equity loops under `MIDAS_MAX_KEYED_USERS`. The retired
  execution prototype is superseded by the fail-closed safety hold.

## Week 4 — scale & polish

- **Shared instance, harden & document** — the multi-user posture on a
  managed box (auth, per-user read keys, caps). ✅ *Shipped:* the `KEYS`
  panel makes per-user keys usable without curl. No billing code — Midas is
  free and open source.
- 🟡 **Docs site.** The strict MkDocs build and static-demo workflow are
  shipped. Public Pages deployment remains an operator step: enable Settings →
  Pages → Source: GitHub Actions and set `MIDAS_PAGES_ENABLED=true` as described
  in the maintenance playbook.
- ✅ **Performance pass.** *(Shipped)* Bundle budgets enforced in CI
  (main ≤155 KB gzip, total JS ≤700 KB; at 136/598 today) and a
  dependency-free load-test script (`scripts/loadtest.mjs`) for pre-invite
  box checks. Memory stays bounded by construction: pool LRU 25, keyed-user
  loop cap, ring buffers, capped rate-limit map — each with tests.
- ✅ **v0.5.0** — released; retro below. Roadmap v3 fills in from beta
  feedback.

## Retro — the second 30 days

**Code shipped:** all four weeks. Public Pages activation remains an explicit
operator step. Adoption (demo mode, START, SYS),
multi-user groundwork (per-user keys PR 1–3 end to end, rate limiting),
retention (P&L recap, alert templates, share links), scale
(KEYS panel, docs build, budgets, load checks). Server tests 121→186; web
1706→1774; four releases (0.2.0 → 0.5.0) in two days of calendar time.

**What worked:** design-doc-first for the security-sensitive slice (PR 3
reviewed against an agreed shape); the four-gate discipline (zero broken
merges); honesty-as-a-feature keeps writing itself into every panel.

**What to watch:** the key store and per-user loops are young — treat the
first hosted incidents as roadmap input, not surprises; the digest is
operator-only until per-user webhooks exist; no billing code — and none
planned, Midas stays free and open source.

## Roadmap v3 (skeleton — filled from user feedback)

1. **User feedback loop** — first handful of self-hosters, weekly friction lists.
2. **Per-user webhooks + digests** — the recap, per user, to their Discord.
3. **Deeper data core** — more first-class live sources behind the honest
   provider seam (never mislabeling provenance).
4. **What users demand** — deliberately unplanned until they tell us.

## Standing invariants (unchanged, non-negotiable)

1. Read-only by default; every write opt-in, capped, confirmed, audited.
2. Data honesty: synthetic/delayed/unavailable is always labeled.
3. Keys never leave the server they were given to; Midas never custodies funds.
4. Free and open source, forever — no paid tier, no gated features;
   self-hosting includes everything.
5. Every slice lands with tests + the four gates green.
