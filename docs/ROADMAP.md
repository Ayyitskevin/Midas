# Midas — 30-day roadmap

The next month of development, in dependency order. Grounded in what shipped in
v0.2.0 (full non-custodial account & execution suite, safeguards, pro-terminal
UX). Each item is a small, verifiable slice — the same one-PR-per-slice cadence
the repo has used throughout.

## Week 1 — order lifecycle depth

- ✅ **Fill notifications.** *(Shipped)* The account watcher (a keyed, read-only
  background poll mirroring the alert engine's loop) diffs open-order snapshots
  and pushes fill/cancel toasts + the operator webhook
  (`MIDAS_ACCOUNT_WATCH_MS`, `GET /api/account/events`).
- ✅ **Order status tracking in TICKET.** *(Shipped)* After placement the ticket
  polls the read-only `GET /api/orders/:id` lookup until filled/canceled and
  shows the progression inline (placed → partial → filled) with a progress bar.
- ✅ **Post-trade slippage.** *(Shipped)* TICKET records its estimated avg
  fill per placement; FILLS shows signed realized-vs-predicted slippage (bp)
  per fill, honestly blank for orders placed outside Midas.

## Week 2 — market data depth

- ✅ **WebSocket account streams.** *(Shipped)* Where ccxt.pro supports
  watchOrders, the stream NUDGES the account watcher to poll immediately —
  fills surface in ~1s. REST stays the source of truth, so unsupported venues
  degrade to plain polling.
- ✅ **Multi-venue account view.** *(Shipped)* Optional second keyed exchange
  (`MIDAS_CCXT_EXCHANGE_2` + keys); BAL/ORD/POSN/FILLS merge both accounts
  with per-row venue tags and honest secondary-failure notes.
- ✅ **More DEX sources.** *(Shipped)* GeckoTerminal joins Dexscreener behind
  the honest on-chain seam (`MIDAS_DEX_SOURCE=geckoterminal`).

## Week 3 — analytics that close the loop

- ✅ **Execution quality board (XQL).** *(Shipped)* Maker/taker mix, fee totals
  by currency, notional and notional-weighted realized slippage (with honest
  coverage %), account-wide or per symbol, from FILLS data.
- ✅ **Account equity curve (AEQ).** *(Shipped)* Periodic server-side equity
  snapshots (file-backed, hourly by default) charted in-terminal — the paper
  EQ board pattern applied to the real account, with truthful gaps.
- ✅ **Alert on account events.** *(Shipped)* Alert rules on position
  unrealized P&L (`upnl`, USD, per symbol) and total account equity
  (`equity`, USD) — evaluated by the same engine, webhook-delivered, and
  honest: an unreadable account leaves rules armed rather than firing on
  demo/stale numbers.

## Week 4 — distribution & (optional) SaaS groundwork

- **Real README screenshot/GIF** of the Trade Desk workspace.
- **Demo instance** (mock provider, trading off) behind a tiny VPS + caddy —
  the "try it in 5 seconds" funnel. ✅ *Half-shipped:* `scripts/deploy.sh`
  one-command production deploy; the public instance itself remains.
- **Per-user API keys (hosted-tier groundwork).** Move exchange keys from
  process env to encrypted per-user server storage — the one architectural
  change a multi-tenant hosted tier needs. Design doc first. The hosted-tier
  **waitlist** (README) is live to size demand first.
- ✅ **Release tags + changelog.** *(Shipped in v0.3.0)* `CHANGELOG.md`, the
  in-terminal `WN` panel, and a one-time update toast per version.

## Standing invariants (never traded away)

1. Read-only by default; every write opt-in, capped, confirmed, audited.
2. Data honesty: synthetic/delayed/unavailable is always labeled.
3. Keys never leave the operator's server; Midas never custodies funds.
4. Every slice lands with tests + the four gates green.
