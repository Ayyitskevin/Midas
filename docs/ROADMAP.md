# Midas — 30-day roadmap

The next month of development, in dependency order. Grounded in what shipped in
v0.2.0 (full non-custodial account & execution suite, safeguards, pro-terminal
UX). Each item is a small, verifiable slice — the same one-PR-per-slice cadence
the repo has used throughout.

## Week 1 — order lifecycle depth

- **Fill notifications.** A keyed background poll (reusing the alert engine's
  loop) that diffs open orders / fills and pushes "order filled" toasts + the
  operator webhook. The single most-requested follow-up to live trading.
- **Order status tracking in TICKET.** After placement, poll the order until
  filled/canceled and show the progression inline (placed → partial → filled).
- **Post-trade slippage.** Compare each fill against the preview's estimated
  avg price and surface realized-vs-predicted slippage in FILLS.

## Week 2 — market data depth

- **WebSocket account streams.** Where ccxt.pro supports it, stream balance /
  order / fill updates instead of polling (the trades/book stream plumbing
  already exists).
- **Multi-venue account view.** Optional second keyed exchange; BAL/ORD/POSN
  gain a venue column (the seam already isolates the exchange client).
- **More DEX sources** behind the honest on-chain seam (GeckoTerminal fallback).

## Week 3 — analytics that close the loop

- **Execution quality board (XQL).** Maker/taker mix, average slippage, fee
  totals by symbol/day, from FILLS data.
- **Account equity curve.** Persist periodic equity snapshots server-side and
  chart them (the paper-portfolio EQ board pattern, applied to the real account).
- **Alert on account events.** Alert rules on position P&L and balance drift,
  not just prices.

## Week 4 — distribution & (optional) SaaS groundwork

- **Real README screenshot/GIF** of the Trade Desk workspace.
- **Demo instance** (mock provider, trading off) behind a tiny VPS + caddy —
  the "try it in 5 seconds" funnel.
- **Per-user API keys (hosted-tier groundwork).** Move exchange keys from
  process env to encrypted per-user server storage — the one architectural
  change a multi-tenant hosted tier needs. Design doc first.
- **Release v0.2.x tags + changelog** so self-hosters can pin.

## Standing invariants (never traded away)

1. Read-only by default; every write opt-in, capped, confirmed, audited.
2. Data honesty: synthetic/delayed/unavailable is always labeled.
3. Keys never leave the operator's server; Midas never custodies funds.
4. Every slice lands with tests + the four gates green.
