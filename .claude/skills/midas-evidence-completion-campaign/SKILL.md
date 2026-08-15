---
name: midas-evidence-completion-campaign
description: >-
  The EXECUTABLE, gate-driven campaign to close the two data-trust exemptions
  that sit under flagship boards: the ORDER BOOK (six modules — BOOK, DEPTH
  heatmap, LIQUIDITY, IMB, TWAP, SLIPPAGE — render or derive from unreceipted
  depth, and the ccxt reader FABRICATES a snapshot time when the exchange omits
  one) and the SINGLE-VENUE SCREENER (SCR, HEAT, MOV poll a bare row array that
  silently drops every symbol with unknown 24h change and records no coverage).
  Load this when the task is to receipt the order book or screener, remove a
  dataCoverage.ts temporary exemption, fix the `ob.timestamp ?? this.now()`
  fabrication, make OrderBook.timestamp nullable, wrap /api/screener in a
  BoardEnvelope, count dropped screener rows, or put Source Inspector evidence
  on BOOK/HEAT/SCR/TWAP/SLIPPAGE. Triggers: "close the screener exemption",
  "order-book receipts", "receipt the order book", "unreceipted boards",
  "fabricated timestamp", "screener coverage", "evidence completion",
  "remove temporary exemption", "trust plane follow-through". This is a phased
  runbook with measurable gates; provenance mechanics belong to
  midas-data-honesty-and-provenance and promotion routes through
  midas-change-control.
---

# Campaign: Evidence completion — receipts under the flagship boards

You are executing a reviewed, verified plan. This is a **runbook**, not an essay.
Follow the phases in order. Every gate is a number or a failing→passing test —
**do not judge success by eye.**

## The one-paragraph problem statement (verified 2026-08-15, main @ `d25e318`)

The trust plane is the product's spine, and it is excellent where it applies —
but two of its seven `temporary-exemption` routes sit under the most-viewed
boards, and both hide a real honesty defect behind the exemption. **Order book:**
`/api/orderbook/:symbol` returns the provider payload bare
(`apps/server/src/routes/market.ts:232-242`), and the ccxt reader stamps the
server clock over a missing exchange snapshot time —
`timestamp: ob.timestamp ?? this.now()` (`apps/server/src/providers/ccxt.ts:427`)
— which is fabricated freshness by the trust plane's own doctrine ("a missing
source time is an unknown freshness state", `docs/DATA_TRUST_PLANE.md`). The
contract makes the fabrication compulsory: `OrderBook.timestamp` is non-nullable
(`packages/shared/src/market.ts:95-103`). Six modules consume this surface —
`OrderBookModule`, `OrderBookDepthHeatmapModule`, `LiquidityModule`,
`ImbalanceModule`, and two that **derive execution estimates** from it,
`TwapModule` and `SlippageModule` — derived-from-unreceipted is exactly what the
plane exists to prevent. **Screener:** `/api/screener` returns a bare
`ScreenerRow[]` (`routes/market.ts:344-366`), and the ccxt implementation
silently `continue`s past every symbol whose 24h change is unknown
(`providers/ccxt.ts:661-662`) — honest-by-omission, but nothing records how many
rows vanished, and three boards poll it (`ScreenerModule`, `HeatmapModule` on a
15s interval, `MarketOverviewModule`). The envelope contract's own doc comment
already *claims* the screener among envelope boards
(`packages/shared/src/board.ts:1-11`) — the code contradicts the comment. Both
exemptions carry their removal condition in `apps/server/src/dataCoverage.ts`
(order book :98-104, screener :127-134); this campaign is those two conditions,
executed.

> Provenance vocabulary (`live | synthetic | unavailable`, freshness states,
> LIVE/SIM badge rules, demo↔server fidelity): **do not restate it** —
> `midas-data-honesty-and-provenance` owns it. Change mechanics (branch, PR,
> draft-for-human, no merge/deploy): `midas-change-control` owns them.

---

## Phase 0 — Orient and pin the baselines (read-only, ~15 min)

Confirm each number on your checkout before writing anything. If a baseline
does not match, STOP and re-derive the plan from the current code — someone
may have landed part of this campaign already.

- **B1 — exemption count:**
  `grep -c "temporary-exemption" apps/server/src/dataCoverage.ts` → expect **7**
  entries via the `exempt(` helper (order-book, on-chain, screener,
  coin-universe, account-events, account-equity, order). This campaign removes
  exactly **2** (order-book, screener). The other five are out of scope.
- **B2 — unreceipted flagship consumers:**
  `grep -rln 'api.orderbook' apps/web/src/modules/` → **6** files;
  `grep -rln 'api.screener' apps/web/src/modules/` → **3** files.
- **B3 — the fabrication:**
  `grep -n 'ob.timestamp ?? this.now()' apps/server/src/providers/ccxt.ts` →
  **1** hit. This line must not survive the campaign.
- **B4 — the silent drop:**
  `providers/ccxt.ts` `screen()`: `if (changePercent === null) continue;` —
  confirm it still exists and that `ScreenerRow.changePercent` is non-nullable
  (`packages/shared/src/market.ts:1028-1037`).
- **B5 — green baseline:** `pnpm -r typecheck` (3/3),
  `pnpm --filter @midas/server test` and `pnpm --filter @midas/web test` both
  green. Record the test counts; your PR body reports the before→after deltas.
- **B6 — family union:** `TRUST_DATASET_FAMILIES`
  (`packages/shared/src/dataTrust.ts:15-35`) contains neither `'order-book'`
  nor `'screener'`. Both get added.

**Phase 0 exit gate:** you can state B1-B6 in numbers. Then branch per
`midas-change-control` and build.

---

## Phase 1 — Order-book evidence (fixes a fabrication; do this first)

One PR. The fabrication outranks the omission, so this phase leads.

### 1a. Contract migration (shared)

- `OrderBook.timestamp: number` → `number | null` with a doc comment stating
  the null meaning (exchange omitted the snapshot time; freshness is unknown,
  not fresh). This is a deliberate compile-time migration — the `Quote.asOf`
  precedent, named in `docs/DATA_TRUST_PLANE.md` ("upstream timestamps that can
  genuinely be absent are nullable").
- Add optional `receipt?: DataReceipt` to `OrderBook` (additive; the object
  shape can carry it without an envelope, unlike the screener's bare array).
- Add `'order-book'` to `TRUST_DATASET_FAMILIES`.

### 1b. Providers

- ccxt `getOrderBook` (`providers/ccxt.ts:413-431`): `timestamp:
  positive-finite(ob.timestamp) ?? null`. **Never** the server clock. Use the
  same coercion helpers the file already imports.
- Declare the `order-book` family in every provider capability manifest the
  conformance harness enumerates — ccxt
  (`providers/ccxt/capabilities.ts`), mock, and yahoo. Check what yahoo
  actually returns for `getOrderBook` before declaring; if it cannot serve
  depth, the honest declaration is `unavailable`, not a stub.
- Add conformance probes for the family on mock and ccxt
  (`providers/conformance.test.ts`); the harness **fails the suite** on any
  declared-but-unprobed family, so this is not optional. The hermetic ccxt fake
  may need a `fetchOrderBook` stub — extend the fake, and if the production
  path turns out to make a call the fake doesn't need (the `loadMarkets`
  precedent from the venue-screener build), fix production, not the fixture.

### 1c. Route

- `/api/orderbook/:symbol`: attach an observed receipt via
  `attachProviderReceipt` (`routes/dataTrust.ts:243`) with family
  `'order-book'`, `sourceAsOf` = the (now nullable) snapshot timestamp,
  a depth-truncation note when `bids/asks` were clipped to the requested depth,
  and the standard unknown-time limitation when `timestamp` is null.
- Flip the `dataCoverage.ts` entry from `exempt(...)` to
  `receipt('order-book')`. The structural test will force this to be
  consistent.

### 1d. Web + demo

- `OrderBookModule` and `OrderBookDepthHeatmapModule` render the receipt
  through the existing `SourceInspector` / `Freshness` components — never a
  green badge over a null snapshot time.
- `TwapModule` and `SlippageModule` compute **estimates from one depth
  snapshot**: label the output as derived from the receipted snapshot (reuse
  the receipt; a full server-side derived receipt is NOT required for this
  phase — the browser-local estimate precedent in `docs/DATA_TRUST_PLANE.md`
  covers client-side derivation labeling). `LiquidityModule` / `ImbalanceModule`
  get the same badge treatment as BOOK.
- Demo shim (`apps/web/src/demo/shim.ts:248-250`): synthetic receipt via the
  existing `demoReceipt` helper, same shape as the server response — the demo
  fidelity tests will hold you to parity.

### Phase 1 exit gates

- **G1:** B3 grep returns **0** hits; a unit test pins `timestamp: null` (not
  server time) for an upstream book without a timestamp.
- **G2:** exemption count 7 → **6**; route-coverage test green with
  `receipt('order-book')`.
- **G3:** conformance suite green with the new family probed on mock + ccxt.
- **G4:** failing→passing proof — stash only the source changes and count the
  new tests that fail. (Stash pitfall, learned the hard way: untracked new
  files do NOT stash by default; use `git stash -u` or the proof silently
  proves nothing.)
- **G5:** full gates green: `pnpm -r typecheck`, both test suites, web build +
  bundle budget (`scripts/check-bundle.mjs` — main ≤ 155 KB), static demo
  build, `pnpm test:reviewer`.

---

## Phase 2 — Screener coverage (fixes the silent drop)

Second PR. Independent of Phase 1 except for merge-conflict ordering.

### 2a. Contract

- `ScreenerRow.changePercent: number` → `number | null`. The
  `VenueScreenRow` nullable-change precedent
  (`packages/shared/src/market.ts`, `Omit<ScreenerRow, 'changePercent'>`) is
  the model — after this migration, consider collapsing that Omit since the
  base type now matches; do it only if the diff stays small.
- `/api/screener` moves from bare `ScreenerRow[]` to `BoardEnvelope<ScreenerRow>`
  (`packages/shared/src/board.ts`). This is a **pre-release wire change**:
  every consumer is in-repo (three modules + demo shim + `lib/api.ts`), the
  envelope doc comment already promises it, and CHANGELOG must record the
  break explicitly. Do not ship a half-measure (per-row receipts on a bare
  array) — board-level coverage counts need a meta home.
- Add `'screener'` to `TRUST_DATASET_FAMILIES`.

### 2b. Provider + route

- ccxt `screen()`: keep rows whose `changePercent` is null instead of
  `continue`-ing past them (unknown ≠ absent), and return alongside the rows
  the counts the receipt needs: tickers scanned, rows eligible for the quote,
  rows with unknown change. Nulls must sort LAST under the change sort —
  `sortCrossVenueScreen` already pins that rule for the venue board; mirror it
  in `sortScreener` with a test.
- Route: wrap in `BoardEnvelope` with `meta` (provenance/source/asOf/cachedAt/
  partial/note) + a route receipt whose `coverage` string reports the counts
  (the venue-screener route at `routes/market.ts:368-440` is the reference
  implementation, including its cache-payload receipt pattern). Flip
  `dataCoverage.ts` to `receipt('screener')`.
- Capability manifests + conformance probes exactly as Phase 1b.

### 2c. Web + demo

- Update `lib/api.ts` screener signature and the three modules. `HeatmapModule`
  colors tiles by change: an unknown-change tile renders **muted/hatched with
  no color claim**, never as 0%-flat green-red midpoint. `ScreenerModule` and
  `MarketOverviewModule` render `—` for unknown change (existing formatting
  helpers do this for other nullables).
- `BoardMeta` strip on the screener board (it exists for the other envelope
  boards), so dropped/unknown coverage is visible, not just receipted.
- Demo shim: envelope + synthetic receipt, mirroring `/api/venue-screener`'s
  demo treatment (`shim.ts:543-575`); include at least one unknown-change row
  in demo data so the muted rendering is exercised by the fidelity tests.

### Phase 2 exit gates

- **G6:** B4's `continue` is gone; a test pins that a ticker with unknown
  change appears in the rows with `changePercent: null` and sorts last under
  the change sort.
- **G7:** the receipt coverage string reports scanned/eligible/unknown counts;
  a fixture test asserts exact counts.
- **G8:** exemption count 6 → **5**.
- **G9:** the `board.ts` doc comment and `docs/DATA_TRUST_PLANE.md` v1 coverage
  table are updated to match reality (screener now receipted; order book from
  Phase 1). Doc drift was part of the finding; closing it is part of done.
- **G10:** same full-gate sweep as G5, plus CHANGELOG entries for both the wire
  change and the nullable migration.

---

## Phase 3 — Conditional cleanup (same PR as Phase 2 or skip)

Only if Phases 1-2 left the two routes copy-pasting ≥ ~30 lines of
receipt/cache ceremony: extract a shared helper in `routes/` (the
`trackProviderCall` + attach + `CachedReceiptPayload` sequence). Do NOT
refactor the other envelope boards onto it in this campaign — that is a
separate, mechanical PR if the maintainer wants it. If the duplication is
small, skip this phase entirely and say so.

---

## What this campaign does NOT do (parked, human-gated)

- **Evidence history** (persist rolling liquidation/dispersion windows via the
  `writeFileAtomic` seam in `apps/server/src/persist.ts` for replay/heatmaps
  over time): real value, larger scope, needs the maintainer to opt in to a new
  persisted store. Seed it as its own campaign if asked.
- **Module curation** (249 modules; which boards are flagship vs long-tail):
  product decision, not code. Raise it; do not decide it.
- The five remaining exemptions (on-chain, coin-universe, account-events,
  account-equity, single-order): each carries its own backlog note in
  `dataCoverage.ts`; none is part of this campaign.

## Standing guardrails (every phase)

- Humans own merge, exchange config (`MIDAS_CCXT_*`), and deploy. Draft PR,
  then stop.
- Tests stay hermetic — no live exchange, no network, no model calls.
- Missing evidence renders as unknown; it is never coerced to 0, `now()`, or a
  reassuring default. That rule is the campaign.
- The README command table, module codes, and command registry are untouched —
  this campaign adds no commands.
- Focused test form: `pnpm --filter @midas/server exec vitest run <pattern>`
  (the `-- <name>` form does not filter).

## Metrics recap

| | Metric | Target |
|---|---|---|
| **M1** | `temporary-exemption` entries in `dataCoverage.ts` | 7 → **5** |
| **M2** | Flagship modules rendering unreceipted numbers | 9 → **0** |
| **M3** | Screener rows silently dropped for unknown change | dropped → **kept as null, counted in the receipt** |
| **M4** | Fabricated order-book timestamps | `?? this.now()` → **null + unknown freshness** |
| **M5** | Doc↔code drift (board.ts comment, trust-plane table) | **0** known contradictions |
