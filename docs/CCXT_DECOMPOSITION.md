# Decomposing `providers/ccxt.ts`

`apps/server/src/providers/ccxt.ts` is 2,735 lines and carries eight unrelated
concerns behind one class. This is the incremental split plan. Every step is
behavior-preserving, independently mergeable, and leaves the suite green.

Two hard constraints shape everything below:

1. **The conformance kit** (`conformanceKit.ts`) requires every method named in
   the capability manifest (`getDvol|getFuturesTermStructure|getOptionsChain`,
   `liquidationsProvenance|getDerivatives`, …) to be callable on the provider
   instance. So methods stay on `CcxtProvider` as one-line delegates; logic
   moves to free functions in `providers/ccxt/`. No interface changes to
   `DataProvider`.
2. **Receipt identity.** `withProviderReceipt(this, …)` embeds the provider's
   name/capabilities. Extracted functions must receive the provider instance,
   not just an `Exchange`, or receipts drift from the manifest and conformance
   fails.

The working pattern, already precedented by `mock.ts` + `mock/`: the class file
keeps construction, the capability manifest, and thin methods; sibling modules
hold pure logic taking explicit parameters.

## 1. What lives in ccxt.ts today

Module scope (lines 1–371):

| Lines | Contents | Concern |
| --- | --- | --- |
| 1–97 | imports; re-export of `compareExchangeIds/isKnownExchange/safeErrorLabel/toPerpSymbol` from `ccxt/helpers.ts` for stable import sites | — |
| 99–107 | `HOUR_MS`, `LIQUIDATION_THROTTLE_NOTE` | liquidations |
| 109–137 | `aggregateCandles`, `intervalForSeconds` | history |
| 139–153 | `finiteOrNull`, `nonNegativeFiniteOrNull`, `positiveFiniteOrNull`, `sourceTimestampOrNull` | numeric coercion (duplicates private copies in `helpers.ts:260–270`) |
| 155–191 | `parseLiquidationRows` | liquidations |
| 193–220 | `crossVenuePartialLimitation`, `withRowReceiptLimitation` | venue compare |
| 222–240 | `MappingSummary`, `assertUsableAccountMapping`, `accountOmissionCaveat` | account reads |
| 242–268 | `normalizedFieldOmission`, `fundingOmission`, `openInterestOmission` | derivatives |
| 270–273 | `optionOiScore` | options |
| 275–330 | `tradingSafetyHold`, `classifyCancelError` | trading writes |
| 332–371 | `CcxtUserCreds`, `CcxtProviderDeps`, `CCXT_PROVIDER_VERSION`, `ccxtCapability`, `DeribitOptionQuote` | shared / manifest / options |

Class `CcxtProvider` (385–2735):

| Lines | Methods | Concern |
| --- | --- | --- |
| 386–507 | fields + constructor, incl. capability-manifest construction (445–507) and secondary-venue client (431–444) | construction + manifest |
| 509–532 | `secondary`, `hasKeys`, `fromSecondary` | account reads wiring |
| 534–574 | `streamAccountNudge` (ccxt.pro watchOrders) | streaming |
| 576–615 | `getQuote`, `getQuotes` | quotes |
| 617–725 | `getHistory` (incl. timeframe substitution + aggregation) | history |
| 727–745 | `getOrderBook` | quotes |
| 747–823 | `getExchangeQuotes` | venue compare |
| 825–919 | `getVenueDerivatives` | venue compare |
| 921–1040 | `getDerivatives` (funding + OI + liquidation snapshot) | derivatives |
| 1042–1203 | `liquidationSourceCapabilities`, `getVenueLiquidations`, `liquidationsProvenance` | liquidations |
| 1205–1216 | `getDexPools` (dexscreener/geckoterminal wiring) | on-chain |
| 1218–1278 | nine `getSolana*` methods + `solPrice` | on-chain wiring |
| 1280–1413 | `getBalances`, `priceAssetsUsd` | account reads |
| 1415–1497 | `getOpenOrders` | account reads |
| 1499–1584 | `getPositions` | account reads |
| 1586–1690 | `getFills` | account reads |
| 1692–1752 | `getOrder`, `cancelOrder`, `placeOrder` | trading |
| 1754–1818 | `getFundingHistory` | derivatives |
| 1820–2036 | `getOiDelta` (OI-history + OHLCV alignment) | OI delta |
| 2038–2479 | Deribit block: `deribitClient`/`deribit()`/`baseAsset`, `dvolUnavailable` + `getDvol` (2063–2145), `getFuturesTermStructure` (2147–2282), `getOptionsChain` (2284–2479) | options |
| 2481–2549 | `getVenueScreen` | venue compare |
| 2551–2608 | `screen`, `search`, `getNews` | market core |
| 2610–2735 | internals: `normalize`, `ensureMarkets`, `toQuote`, `getCompareExchanges`, `resolveTimeframe`, `describe` | shared |

## 2. Target layout

```
apps/server/src/providers/
  ccxt.ts                     class shell: constructor, manifest, delegates,
                              market core (quote/history/orderbook/screen/search)
  ccxt/
    helpers.ts                (unchanged — existing)
    coerce.ts                 finiteOrNull family, aggregateCandles, intervalForSeconds
    context.ts                CcxtSymbolContext → CcxtReadContext → CcxtCompareContext
    crossVenue.ts             crossVenuePartialLimitation, withRowReceiptLimitation
    capabilities.ts           ccxtCapability + buildCcxtCapabilities factory
    options.ts                deribit client access, getDvol, term structure, chain
    liquidations.ts           parseLiquidationRows, venue liquidations, provenance
    derivatives.ts            getDerivatives, getFundingHistory, omission helpers
    oiDelta.ts                getOiDelta
    venueCompare.ts           getExchangeQuotes, getVenueDerivatives, getVenueScreen,
                              compare-set construction
    account.ts                balances/orders/positions/fills/getOrder, priceAssetsUsd,
                              fromSecondary, MappingSummary helpers
    trading.ts                placeOrder/cancelOrder, classifyCancelError, tradingSafetyHold
    onchain.ts                getDexPools + getSolana* + solPrice wiring
```

Every module imports only from `../types`, `../receipts`, `./helpers`,
`./coerce`, `../balances`, `../accountReads`, `../trading`, `../util`,
`../dexscreener`, `../geckoterminal`, `../../solana/*`. **None imports
`../ccxt`** — that is the one rule that keeps the graph acyclic.

Extracted functions take the provider instance, typed through ONE shared
context hierarchy in `ccxt/context.ts` — never a per-module copy:

| Interface | Adds | Used by |
| --- | --- | --- |
| `CcxtSymbolContext` | `normalize` | `onchain.ts` (no clock, no venue client) |
| `CcxtReadContext` | `now`, `exchange`, `exchangeId` | most readers |
| `CcxtCompareContext` | `compareExchanges()` | `liquidations.ts`, `venueCompare.ts` |

`account.ts` widens `CcxtReadContext` locally with `userKeyed`, `secondary` and
`describe` — those three stay out of the base so a market-data module cannot
reach the account surface. A module asks for the narrowest context it uses.

The class satisfies these structurally (which is why `exchange`, `exchangeId`,
`now` and `describe` are public on it — visibility only, no new behavior).
Delegates look like:

```ts
async getDvol(symbol: DvolSymbol): Promise<DvolSnapshot> {
  return fetchDvol(this, this.deribit(), symbol);
}
```

End-state `ccxt.ts`: 821 lines as shipped, down from 2,333 (construction,
manifest assembly, market core, internals, delegates).

## 3. Sequenced steps

Each step = one PR: one new file, one region deleted from ccxt.ts, imports
adjusted. Existing tests must pass **unmodified** — that is the definition of
"pure move" here.

| # | Step | Lines moved | Type |
| --- | --- | --- | --- |
Order matters — see the dependency column. This is the order that shipped
(PR numbers are the Midas PRs that landed each step).

| # | PR | Step | Depends on |
| --- | --- | --- | --- |
| 1 | #361 | `coerce.ts`: finite-or-null family + `aggregateCandles` + `intervalForSeconds`; delete the duplicate private copies in `helpers.ts` and import from `coerce.ts` | — |
| 2a–c | #362 | `options.ts`: `deribit()` accessor, `baseAsset`, `dvolUnavailable`, `getDvol`, term structure, `getOptionsChain` + `optionOiScore` | — |
| 3 | #363 | `oiDelta.ts`: `getOiDelta`. **Creates `context.ts`** — pulled ahead of liquidations/derivatives because it is the first step needing a context, and every later step imports it | 1 |
| 4 | #365 | `liquidations.ts`: `parseLiquidationRows`, `LIQUIDATION_THROTTLE_NOTE`, `getVenueLiquidations`, `liquidationSourceCapabilities`, `liquidationsProvenance`. **Creates `crossVenue.ts`** and `CcxtCompareContext` | 1, 3 |
| 5 | #364 | `derivatives.ts`: `getFundingHistory` + the omission helpers; then `getDerivatives`. Imports `parseLiquidationRows` — it must NOT keep a second copy | 1, 3, 4 |
| 6 | #368 | `venueCompare.ts`: compare-set construction, `getExchangeQuotes`, `getVenueScreen`, `getVenueDerivatives` | 1, 3, 4, 5 |
| 7 | #367 | `trading.ts`: `placeOrder`, `cancelOrder`, `classifyCancelError`, `tradingSafetyHold` | 3 |
| 8 | #366 | `onchain.ts`: `getDexPools`, `getSolana*`, `solPrice` (takes the narrow `CcxtSymbolContext`) | 3 |
| 9 | #369 | `account.ts`: `MappingSummary` helpers, `fromSecondary`, `hasKeys`, `getBalances`, `priceAssetsUsd`, then `getOpenOrders`/`getPositions`/`getFills`/`getOrder` | 1, 3 |
| 10 | #370 | `capabilities.ts`: `ccxtCapability` + manifest factory `buildCcxtCapabilities({ id, name, keyed, has })` | — | 
| 11 | #371 | `routes/market.ts`: board machinery + composed boards (see §5) | — |

Step 10 is the only **interface change**: the constructor's
`conditional`/`account` closures become a factory taking `{ id, keyed, has }`;
manifest output must stay byte-identical (conformance + `capabilities.test`
snapshots catch drift). Everything else is a pure move.

### These steps are NOT order-independent

An earlier draft of this plan said steps 2a–9 could be done in any order in
parallel worktrees. That is wrong, and acting on it cost a rework: eight
branches were cut from the same base, and each independently redeclared what it
shared — seven copies of `CcxtReadContext`, the coercion helpers in five files,
`parseLiquidationRows` and the cross-venue receipt helpers twice each, several
carrying comments like "pending step 1's `coerce.ts`". Merging them in sequence
conflicted in five of ten, because every step edits the same import block and
class body in `ccxt.ts`.

None of it was caught by CI: each branch typechecked, built and passed the full
suite on its own. Duplication and unmergeability are not test failures.

So: **each step branches off the previous one**, as a stack. A step that needs a
shared helper imports it from the step that owns it rather than copying it, and
new shared surface goes in `context.ts` / `crossVenue.ts` / `coerce.ts` — widen
those, never fork them. Steps 1, 2, 10 and 11 touch disjoint regions and are the
only ones that can genuinely go in parallel.

`streamAccountNudge` stays in the class — it reads `process.env` directly and is
entangled with construction; not worth a PR of its own.

## 4. Risks

- **Circular imports.** The only cycle hazard is an extracted module importing
  `../ccxt` (for a type or helper). Forbid it: ctx types live in the new
  modules or in `types.ts`; `CcxtProvider` imports one-way from `ccxt/*`.
  `receipts.ts` already depends only on `types.ts`, so passing `this` into
  receipt helpers is safe.
- **Conformance suite** (`conformance.test.ts` + `conformanceKit.ts`). Three
  traps: (a) delegated methods must keep exact names on the class — the kit
  reflects over `provider[method]`; (b) the manifest must stay exhaustive over
  `TRUST_DATASET_FAMILIES` with identical content — step 10 is the risk here;
  (c) `observedAt` must keep using the injected `deps.now` clock — every
  extracted function must take `now` from ctx, never call `Date.now`.
- **Tests importing internals.** `ccxt.test.ts:5` imports `CcxtProvider,
  compareExchangeIds, safeErrorLabel, toPerpSymbol` from `./ccxt`; the
  re-export at `ccxt.ts:97` must stay (it already documents this).
  `keys/routes.ts:3` imports `isKnownExchange` from `../providers/ccxt` — same
  re-export. `ccxtOptions.test.ts` / `ccxtOiDelta.test.ts` construct
  `new CcxtProvider(undefined, { deribit, exchange, now })` — the
  `CcxtProviderDeps` seam must not change shape in steps 2a–2c and 5.
  No test imports module-level helpers like `parseLiquidationRows` directly
  today, so those may move freely; if a test later wants one, import from the
  new module, don't re-export through ccxt.ts.
- **Sanitization invariants.** `describe`, `safeErrorLabel`, and the "never
  interpolate raw ccxt errors" rule (signed URLs in messages) are spread across
  every method being moved. Moves must carry the exact error-wrapping code,
  not paraphrase it. Diff review should treat any changed string in a moved
  `ProviderError` as a red flag — receipts and error text are snapshot-tested
  indirectly via conformance's private-text check.
- **Shared privates.** `normalize`, `toPerpSymbol(this.normalize(symbol))`,
  `getCompareExchanges` are used by almost every block. Decide once, in step 2a,
  whether ctx exposes `normalize(symbol)` or callers pass pre-normalized perps;
  mixing both conventions across modules will read worse than the monolith did.
- **Worktrees.** `../midas-wt-pr-*` hold active work. Each step touches one
  contiguous region of ccxt.ts plus the import block, so conflicts are
  localized — but land step 1 (coerce) first since everything later depends on
  the import layout, and rebase worktrees between steps, not after several.

## 5. `routes/market.ts` (1,485 lines) — lighter touch

**Shipped as step 11 (#371).** Recorded here as specified.

Don't fully decompose it; do one extraction. The file is a route table plus
two fat composed boards. Move the board machinery — `boardEnvelope`,
`serveBoard`, `serveReceiptPayload`, `registerVenueBoard`,
`suppressStaleArbitrage` (lines ~109–395) — into `routes/boards.ts`, and the
two composed cross-symbol boards — funding (`DATA_ROUTE_PATHS.funding`,
1054–1335) and liquidations (1336–1474) — into `routes/marketBoards.ts` as
`registerFundingBoard(app, deps)` / `registerLiquidationsBoard(app, deps)`
called from `registerMarketRoutes`. That removes ~600 lines without touching a
single route contract, TTL, or envelope shape, and leaves the remaining
quote/history/screener/options routes as the thin one-provider-call handlers
ARCHITECTURE.md already describes. No behavior change, no new abstractions.
(It landed as a single PR rather than the two sketched here.)
