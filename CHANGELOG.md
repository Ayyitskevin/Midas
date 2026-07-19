# Changelog

All notable changes to Midas. The in-terminal `WN` panel shows the same
highlights; this file is the complete record. Versions follow semver;
`apps/server` reports the running version at `/api/health`.

## [Unreleased]

### Added
- **Peer-review readiness layer:** AGPL-3.0-only metadata and license, explicit
  agent/contributor policy, a credential-free loopback reviewer launcher for the
  static synthetic demo, and a focused reviewer guide with reproducible gates.
- **Solana tokens, swaps & market** (Solana Suite, slice 4): **`SPL`** is an SPL
  token (mint) explorer — supply, decimals, program and the mint/freeze
  authorities that decide token safety (an active mint authority can inflate
  supply; an active freeze authority can freeze accounts), from `getTokenSupply` +
  `getAccountInfo` (holder count intentionally omitted — a reliable count needs an
  indexer, not a public RPC). **`SJUP`** shows read-only Jupiter swap quotes —
  best-route output, price impact and AMM hops for a chosen pair and size; it is
  **quote only** (Midas fetches a price estimate and never builds, signs or sends
  a swap, so the "exactly two exchange writes" invariant is untouched). **`SOLMKT`**
  is an ecosystem market overview — SOL's price, an aggregate 24h-volume/liquidity
  roll-up and a top-tokens list. All read-only and non-custodial; live via
  `MIDAS_SOLANA_RPC` (`SPL`), the new `MIDAS_SOLANA_JUPITER` gate (`SJUP`, defaults
  to the current `lite-api.jup.ag` host) and `MIDAS_DEX_SOURCE=geckoterminal`
  (`SOLMKT`); synthetic-but-labeled in the mock provider and static demo, honest
  `unavailable` otherwise.
- **Solana staking & validators** (Solana Suite, slice 3): **`SVAL`** is a
  validator leaderboard — the top validators ranked by activated stake, each with
  its stake share, commission and delinquency status, plus network totals
  (total stake, validator count, delinquent count) — and **`SSTAKE`** shows
  native-staking economics: the real (compounded) staking APY and its nominal
  rate, derived from network inflation ÷ the staked-supply ratio, alongside the
  inflation rate and staked ratio. Both are read-only and non-custodial, live via
  `MIDAS_SOLANA_RPC` (`SVAL` from `getVoteAccounts`; `SSTAKE` from
  `getInflationRate`, `getSupply` and `getVoteAccounts`), synthetic-but-labeled in
  the mock provider and static demo, honest `unavailable` otherwise.
- Sub-cent prices now render with the precision the caller asks for: `fmtPrice`
  honors an explicit `decimals` argument above 4 for sub-$1 values (so a
  0.000023 memecoin shows `0.000023`, not `0.0000`), and the trending panel scales
  its price precision to the token's magnitude. Default two-decimal callers are
  unchanged.
- **Solana DeFi markets** (Solana Suite, slice 2): **`STREND`** ranks trending
  Solana tokens by 24h DEX volume (price, 24h change, volume, liquidity, top
  venue), and **`SOLDEX`** shows a base asset's liquidity across Solana DEXes
  (Raydium/Orca/Meteora/Phoenix/Lifinity) with a VWAP/TVL roll-up. Read-only and
  non-custodial; live via `MIDAS_DEX_SOURCE=geckoterminal` (GeckoTerminal's
  Solana network), synthetic-but-labeled in the mock provider and static demo,
  honest `unavailable` otherwise.
- **Solana, read-only and non-custodial.** A native Solana dimension across the
  stack: **`SOLNET`** (network health — slot, epoch progress, TPS, active
  validators, total stake, circulating/total SOL supply and a live market cap)
  and **`SWAL`** (a wallet inspector that shows any public base-58 address's SOL
  balance and SPL token holdings priced to USD). Both are assembled from
  read-only public-RPC calls only — no key, no signing, no transaction path
  exists, preserving the "exactly two exchange writes" invariant. Live via
  `MIDAS_SOLANA_RPC` (env-gated, default off, honest `unavailable` degradation);
  synthetic-but-labeled in the mock provider and the static in-browser demo, so
  both panels work offline. Wallet addresses are validated with a dedicated,
  case-preserving base-58 edge check (never uppercased). Stablecoins price at
  $1 and SOL from the exchange; unknown SPL tokens are honestly left unpriced.

## [0.5.0] — 2026-07-02

The hosted-ready release: everything a multi-user Midas needs — per-user
keys end to end (store → read → trade → loops), the retention features that
make it a daily habit, and the scale guardrails (budgets, limits, load
checks) to run it for other people.

### Added
- **`KEYS` panel** — manage your per-user exchange keys from the terminal:
  save (write-only, encrypted at rest, never displayed again), inspect the
  metadata (exchange + last 4 + read-only/trade badge), replace or delete in
  one action, with honest states when the store is off or you're signed out.
  The "can trade" toggle carries the warning it deserves.
- **Daily P&L recap in the digest** — the operator digest now leads with
  equity change since the last one (from the snapshot series), and adds the
  period's fills with FIFO round-trip realized P&L (ex-fees, honestly marked
  ≈) plus the biggest 24h movers among your position symbols. Sections that
  can't be read honestly are omitted, never invented. `MIDAS_DIGEST_HOURS=24`
  makes it the morning email.
- **One-click alert templates** — a ⚡ row in `ALERT` arms the classics:
  funding flip (crosses 0, repeating), ±5% daily move (both directions), and
  a 5% equity-drawdown one-shot priced off a live equity read at click time.
- **Workspace share links** — the ⧉ button copies a URL that carries the
  whole workspace in its fragment; opening it imports the layout as a new
  workspace (your own are untouched). The payload never leaves the browser —
  nothing is uploaded, and huge workspaces honestly fall back to file export.
- **Per-user trading + loops** (per-user keys PR 3, completing the hosted
  design): a signed-in user whose stored key is marked trade-permissioned
  places/cancels through **their own** exchange client — never the
  operator's, even if their keys break — behind every existing operator
  gate, with their own UTC-daily notional budget and idempotency scope and
  audited identity. Keyed users also get their own fill watcher + equity
  snapshots (bounded by `MIDAS_MAX_KEYED_USERS`), and their events/equity
  feeds are isolated: their account or an honest "not running", never the
  operator's.
- **Per-user exchange keys** (hosted-tier groundwork, PR 1–2 of the design):
  signed-in users store their own keys via `PUT /api/account/keys`
  — AES-256-GCM encrypted at rest (`MIDAS_KEYS_KMS_SECRET`), metadata-only
  reads, one-action delete — and the account panels resolve to *their*
  exchange client through a bounded provider pool. User-keyed providers are
  strictly isolated from the operator's env (no secondary venue, no stream).
- **Rate limiting** (`MIDAS_RATE_LIMIT_RPM`) — per-IP request ceiling with
  honest 429s; demo mode defaults it on.

## [0.4.0] — 2026-07-01

The "whole roadmap" release: execution analytics, account intelligence,
multi-venue, and the launch funnel — Weeks 1–3 of the 30-day plan plus the
public-demo posture, all shipped.

### Added
- **Demo mode** (`MIDAS_DEMO_MODE`) — one flag that makes an instance safe
  to host publicly: mock data only, trading impossible, signups closed —
  applied over the whole config so a stray env var cannot win. The web
  banner becomes the funnel (deploy-your-own + hosted waitlist CTAs).
- **First-run tour (`START`)** — six one-click rows that each run a real
  command, teaching the grammar by doing; opens once on first visit.
- **System status (`SYS`)** — provider, version, uptime and which
  background loops are actually running, without reading server logs.
- **Post-trade slippage in `FILLS`** — realized vs the estimate `TICKET`
  recorded at placement, signed so positive is always worse; fills placed
  outside Midas honestly show no baseline.
- **Account equity curve (`AEQ`)** — periodic read-only snapshots of total
  account value + unrealized P&L, persisted server-side
  (`MIDAS_EQUITY_SNAP_MS`, default hourly) and charted with truthful gaps.
- **Execution quality board (`XQL`)** — maker/taker mix, fee totals by
  currency, notional and notional-weighted realized slippage with an honest
  coverage %, account-wide or per symbol.
- **Account-event alerts** — rules on position unrealized P&L (`upnl`) and
  total account equity (`equity`), in USD, via the existing alert engine.
- **Account stream nudge** — ccxt.pro `watchOrders` (where supported) makes
  fill notifications near-realtime; REST polling remains the source of truth.
- **Multi-venue account view** — optional second keyed exchange; BAL / ORD /
  POSN / FILLS merge both accounts with per-row venue tags.
- **GeckoTerminal DEX source** — `MIDAS_DEX_SOURCE=geckoterminal` as an
  alternative to Dexscreener behind the same honest seam.

## [0.3.0] — 2026-07-01

The launch-polish release: the terminal now tells you what it saw and what
changed, and the server ships hardened by default.

### Added
- **Operator digest** — every `MIDAS_DIGEST_HOURS` hours, a summary of alerts
  fired and order flow observed (from the account watcher) POSTs to your
  webhook, with honest "counts are minimums" labeling if the event buffer
  overflowed between digests.
- **What's New panel (`WN`)** — release highlights in-terminal, plus a one-time
  "Midas updated to vX" toast when your server moves to a new version.
- **Login throttling** — repeated failed logins lock the account+IP pair out
  briefly (in-memory, resets on restart); failures are logged for operators.
- **Security response headers** on every API response (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`).
- **One-command production deploy** — `scripts/deploy.sh` bootstraps `.env`
  (random auth secret), builds, starts compose and health-checks the stack.

## [0.2.0] — 2026-07-01

The execution release: Midas closes the loop from watching markets to acting
on them — without ever custodying funds.

### Added
- **Non-custodial account suite**: `BAL` balances, `ORD` open orders (with
  per-order cancel), `POSN` positions, `FILLS` executions — all read-only,
  honestly labeled live/demo, keyed via server env only.
- **Gated live trading** in `TICKET`: OFF by default behind a master switch +
  live keyed provider + auth (or explicit no-auth override that **requires** a
  pinned CORS origin); per-order (`MIDAS_MAX_ORDER_USD`) and UTC-daily
  (`MIDAS_MAX_DAILY_USD`) notional caps enforced server-side (fail-safe:
  unpriceable → reject), server-side idempotency on `clientOrderId`, audit
  logs and webhook notification on every write.
- **Fill notifications**: a read-only account watcher diffs open orders and
  pushes fills/cancels as terminal toasts + webhook messages — including
  orders placed outside Midas (`MIDAS_ACCOUNT_WATCH_MS`).
- **Order tracking in `TICKET`**: placed → partially filled → filled/canceled,
  live, with a fill progress bar.
- **Trade Desk** workspace template: chart, book, tape, ticket and account
  panels linked — click a book level to load that price into the ticket.
- Daily notional ledger with reserve-before-place/release-on-failure
  semantics (a concurrency race found and fixed during review).

### Fixed
- 8 command-namespace collisions (aliases silently shadowing other panels),
  now guarded by a CI registry-integrity test.
- Docker compose now passes through every account/trading/DEX variable, so
  deploys have feature parity with `pnpm dev`.

## [0.1.0] — 2026-06

The terminal: everything you need to *watch* crypto markets like a pro.

### Added
- Command-driven tiling workspace (`SYMBOL FUNCTION`), ⌘K palette, linked
  panel groups, named workspaces + templates, import/export.
- Charts (candles, overlays, drawings, live streaming), L2 order book, depth
  heatmap, time & sales, CVD, volume profile.
- Crypto derivatives: funding, open interest, basis, honest liquidations with
  provenance, cross-exchange compare; on-chain/DEX read layer.
- ~115 indicator/analytics boards in a searchable catalog (`BOARDS`), unified
  screener, saved scans, scan-watch alerts, shareable deep-links.
- Price/funding/%-change alerts (client or server engine) with webhook
  delivery and alert→action panel opening.
- Portfolio with live P&L, realized P&L, journal, equity curve, reports/CSV.
- Pluggable data providers (`mock`/`yahoo`/`ccxt`), WebSocket streaming
  (ccxt.pro where available), one-command Docker deploy, optional multi-user
  auth with per-user server sync, AI copilot.
- Data honesty as a first-class principle: every surface labels live /
  synthetic / unavailable.
