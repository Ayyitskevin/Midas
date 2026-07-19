---
name: crypto-market-reference
description: >-
  Crypto-derivatives domain theory AS IMPLEMENTED IN MIDAS — the reference a
  mid-level engineer needs to touch funding/OI/liquidations/basis/order-book
  code without guessing. Load this when you are: reading or changing the
  `compute*` market helpers (`computeVenueArbRow`, `computeFundingDispersion`,
  `computeOiConcentration` in packages/shared/src/market.ts) or the web domain
  math (basis, funding, fundingPnl, carry, liquidations, liquidity, arb,
  venueDerivatives under apps/web/src/lib); wiring the derivatives/venue-board
  routes (`/api/derivatives`, `/api/funding*`, `/api/venue-derivatives`,
  `/api/venue-arb`, `/api/oi-concentration`, `/api/liquidations`); or the ccxt
  provider's funding/OI/liquidation reads (providers/ccxt.ts + ccxt/helpers.ts).
  Also load when a question is domain-shaped: "what does fundingRate mean / what
  unit is it", "is this timestamp seconds or ms", "base vs quote / notional",
  "what is bps vs pct here", "which side is a liquidated long", "why is the
  liquidation feed empty or underreporting", "perp basis vs premium vs spot",
  "how do we annualize funding", "Herfindahl OI concentration", "cross-venue
  spread bps", "what does open interest tell me", or Solana/DEX read basics.
  Defines each term with its exact in-repo type + unit and file:line. NOT the
  provenance labeling mechanics (see midas-data-honesty-and-provenance), NOT the
  campaign (see midas-honest-derivatives-campaign), NOT the module map (see
  midas-architecture-contract).
---

# crypto-market-reference — derivatives domain, as Midas implements it

This is the crypto-derivatives theory you need to work on Midas's market code —
**grounded in the repo, not a textbook**. Every formula below is anchored to a
`file:line`. When code and your memory of "how funding usually works" disagree,
**the code wins** — Midas makes specific, sometimes simplifying, choices and you
must match them exactly (a units slip here is recurring bug class G: seconds-vs-ms,
fraction-vs-bps, base-vs-quote).

Midas is a **read-only, non-custodial** research terminal. Everything here is about
*observing and computing on* market data — never placing trades. Order writes are
under an unconditional safety hold (see `midas-change-control`).

---

## 0. The units cheat-sheet — read this FIRST, memorize it

The single biggest source of domain bugs. Every number below has ONE canonical
representation in the contract. Get it wrong and it silently poisons compare rows,
alerts, and the screener.

| Quantity | Type | Unit / convention | Ground |
|---|---|---|---|
| `Candle.time` | `number` | **seconds** (Unix, UTC) | market.ts:17-18 |
| `Quote.asOf`, `OrderBook.timestamp`, `nextFundingTime`, `Liquidation.timestamp`, `*.asOf`, `FundingHistoryPoint.time` | `number` | **epoch milliseconds** | market.ts:48-49, 96, 216, 234, 489 |
| `fundingRate` | `number \| null` | **fraction per interval** — `0.0001` = 0.01% | market.ts:319, 209, 336 |
| funding **APR** (`fundingAprPct`, `aprPct`) | `number` | **percent** (already ×100) | basis.ts:42, funding.ts:9 |
| `openInterest` | `number \| null` | **base units** (contracts/coins) | market.ts:324 |
| `openInterestValue` | `number \| null` | **quote notional** (≈ USD for USDT perps) | market.ts:327, 215 |
| `spreadBps`, `dispersionBps`, funding `spreadBps` | `number \| null` | **basis points** = ratio × `10_000` | market.ts:135, 139, 371 |
| `premiumPct`, `basisPct`, `changePercent`, `dispersionPct` | `number` | **percent** = ratio × `100` | basis.ts:41, carry.ts:40, market.ts:43 |
| `Liquidation.side === 'sell'` | — | **a LONG was liquidated** | market.ts:229 |
| `Liquidation.side === 'buy'` | — | **a SHORT was liquidated** | market.ts:229 |
| `AccountPosition.side` | `'long' \| 'short'` | the position itself | account.ts:92 |

**bps vs pct**: a *ratio* (like a spread `Δ/base`) becomes **bps** by ×10_000 and
**pct** by ×100. So 1% = 100 bps. Midas uses **bps for tight cross-venue spreads**
(funding/price disagreement, order-book spread) and **pct for human-scale returns**
(premium, APR, day change). Never mix them in one column.

---

## 1. Perpetual futures & the derivatives snapshot

A **perpetual future ("perp")** is a leveraged derivative that tracks a spot index
with no expiry. Instead of expiring to converge on spot, it uses a **funding rate**
(§2) — periodic payments between longs and shorts — to tether its price to spot.
Midas is perp-centric: derivatives reads key off a perp symbol.

**Perp symbol form** — Midas derives the USDT-margined perp from a spot pair:
`BTC/USDT` → `BTC/USDT:USDT` (the `:QUOTE` settle suffix). An already-perp symbol
passes through; a malformed pair falls back to a `:USDT` settle.
Ground: `toPerpSymbol`, ccxt/helpers.ts:119-121.

The canonical snapshot is **`DerivativesInfo`** (market.ts:314-330), returned by
`getDerivatives(symbol)` and served at `GET /api/derivatives/:symbol`:

| Field | Meaning | Unit |
|---|---|---|
| `fundingRate` | current funding rate | fraction (§0) |
| `nextFundingTime` | when funding next settles | epoch ms |
| `markPrice` | the perp's **mark** — fair price used for P&L / liquidation | quote |
| `indexPrice` | the underlying **spot index** the perp tracks | quote |
| `openInterest` | total open contracts | **base** units |
| `openInterestValue` | same, as notional | **quote** |
| `recentLiquidations` | last ≤20 liquidation prints | `Liquidation[]` |

**Mark vs index vs last**: `last`/`close` is the last traded price; `markPrice` is a
smoothed fair value (drives P&L and liquidation, resists wicks); `indexPrice` is the
spot reference the perp is tethered to. `getDerivatives` reads mark+index from
`fetchFundingRate` (helpers.ts:141-146); when a venue omits a field it stays `null`,
never fabricated.

---

## 2. Funding rate — definition, sign, annualization

**Funding rate** = the periodic payment (a fraction of position notional) exchanged
directly between longs and shorts to pull the perp's mark toward spot. Positive →
**longs pay shorts** (perp rich vs spot); negative → **shorts pay longs**.
Ground: sign convention in fundingPnl.ts:48 (`side === 'long' ? -1 : 1` with comment
"long pays positive funding") and carry.ts:43 (`fr > 0 ? 'short-perp'` collects).

- Stored as a **fraction per settlement interval** (market.ts:319). `0.0001` = 0.01%
  paid *that interval*, not per year.
- **Interval**: Midas assumes **8-hour funding** (3/day) everywhere it annualizes —
  see the ASSUMPTION note below. `nextFundingTime` comes from the exchange and is the
  source of truth for *when*; the 8h figure is only used to *annualize*.

**Annualize funding** (two equivalent in-repo forms, both → percent):

```
annualizedFundingPct(rate, intervalHours=8) = rate * (24/intervalHours) * 365 * 100   # funding.ts:9
computeBasis.fundingAprPct               = rate * fundingsPerYear * 100                # basis.ts:42
```

With defaults both reduce to `rate * 1095 * 100` (8h → 3/day → **1095** settlements/yr;
`DEFAULT_FUNDINGS_PER_YEAR = 1095`, basis.ts:9). Worked: `fundingRate = 0.0001` →
`0.0001 × 1095 × 100 ≈ 10.95%` APR. `null` in → `null` out (funding.ts:8).

> **ASSUMPTION (matches the code, know its limit):** the annualizers hard-default to
> 8h. Real venues also fund at 1h or 4h; for those, the APR here is wrong by the
> interval ratio unless the caller passes `intervalHours`/`fundingsPerYear`. This is a
> deliberate simplification, not a bug — if you add a per-venue interval, thread it
> through `annualizedFundingPct` and `computeBasis`, and ship a failing→passing test.

**Funding-carry P&L projection** (`projectFunding`, fundingPnl.ts:38-70): projects the
signed carry of *holding* a perp at a constant rate. `perInterval = sideSign × notional
× rate` where `sideSign = long ? -1 : +1`. `receives = perInterval >= 0`. `aprPct`,
`daily`, `horizonTotal`, and a capped cumulative `points[]` series follow linearly. It
**assumes the current rate holds for the whole horizon** — a projection, not a forecast.

**Funding-history stats** (`summarizeFunding`, fundingHistory.ts:22): current/avg rate,
their APR (via the shared annualizer), min/max, and `positiveShare` (fraction of
settlements where longs paid). Served upstream by `getFundingHistory` → `/api/funding-history`.

---

## 3. Basis & premium — and the TWO different "basis" definitions

**Basis** = how far the perp trades from its reference. Midas has **two distinct
denominators** — do not conflate them:

| Metric | Formula | Reference | Ground |
|---|---|---|---|
| `premiumPct` (BASIS panel) | `(mark / indexPrice − 1) × 100` | perp's own **index price** | basis.ts:41 |
| `basisPct` (carry / cash-and-carry) | `(mark / spot − 1) × 100` | actual **spot ticker** price | carry.ts:40 |
| `basis` (absolute) | `mark − index` | quote units | basis.ts:40 |

`computeBasis` (basis.ts:33) is `valid` only when mark **and** index are both present
and positive; otherwise fields are `null`. `computeCarry` (carry.ts:37) pairs annualized
funding with mark-vs-spot basis and names the leg that *earns* funding: **positive
funding → `short-perp`** collects (short the perp, long spot = delta-neutral cash-and-
carry); negative → `long-perp`; `|fr| < 1e-9` → `flat` (carry.ts:43).

Rule of thumb encoded here: perp premium and funding move together — a perp rich to
spot (positive premium) tends to carry positive funding, which the carry trade harvests.

---

## 4. Open interest (OI) & venue concentration

**Open interest** = total notional of open perp contracts — a *positioning/size*
signal (how much leverage is committed), distinct from *volume* (turnover). Read
per-venue via `readOpenInterest` (helpers.ts:156-168): `openInterest` =
`fetchOpenInterest().openInterestAmount` (**base**), `openInterestValue` =
`.openInterestValue` (**quote notional**); both `null` if the venue lacks the endpoint.

**OI concentration** — how crowded a perp is onto one venue.
`computeOiConcentration(symbol, rows)` (market.ts:461-484) reduces per-venue
`VenueDerivatives[]` to an `OiConcentrationRow`:

- Keeps only venues with **positive** `openInterestValue` (market.ts:462-465). A single
  reporting venue **is a valid row** (share 1, HHI 1) — that is *maximum* crowding, not
  noise, so it is intentionally NOT filtered out (market.ts:459).
- `share_i = venueOI / totalOI`; `topVenueShare` = largest share.
- **Herfindahl index** `herfindahl = Σ(share_i²)`, range `0..1`, where **1 = all OI on
  one venue** (market.ts:449, 481). High total OI + high HHI = venue/crowding risk (one
  exchange holds most of the leverage).

Served at `GET /api/oi-concentration`, ranked by `totalOiValue` desc (market.ts:256-261).

---

## 5. Cross-venue boards — the same fan-out shape, three signals

The moat surface. For a perp/symbol, Midas fans a read across a **compare set** of
venues (default ~6 majors via `MIDAS_CCXT_COMPARE`; exact list + override owned by
`midas-config-and-flags`), then reduces to one row with a **pure** `compute*` helper.
Route wiring is one generic `registerVenueBoard` behind a short TTL cache
(market.ts:49-85). The three helpers live in `packages/shared/src/market.ts` and are
called by **both** the server routes and the in-browser demo engine (identical math on
both sides — that is why they are in `shared`).

### 5a. Funding dispersion — `computeFundingDispersion` (market.ts:389-419)
Per-venue funding → the **funding-arb signal**. Sorts funded venues dearest→cheapest;
reports `minRate`/`maxRate`/`meanRate` (fractions), `highVenue`/`lowVenue`, and
`totalOiValue`. The signal:

```
spreadBps = (maxRate − minRate) × 10_000        # null unless ≥ 2 venues report a rate
```

This is bps of the **per-interval funding rate** (NOT annualized). Trade reading: long
the cheapest-funded venue, short the dearest. Served `GET /api/funding-dispersion`,
ranked by `spreadBps`. (Web twin: `summarizeVenueDerivatives`, venueDerivatives.ts:26,
same idea for the single-symbol view.)

### 5b. Price arb / dispersion — `computeVenueArbRow` (market.ts:155-200)
Per-venue top-of-book → cross-venue price disagreement.

```
spreadBps      = (bestBid − bestAsk) / bestAsk × 10_000   # the arb leg
crossed        = spread > 0                                # highest bid > lowest ask ⇒ gross-of-fees arb
dispersionBps  = (priceMax − priceMin) / priceMin × 10_000 # how much last-prices disagree
```

**Critical guard (market.ts:179-182):** `spreadBps` requires the best bid and best ask
to sit on **different** venues — a single venue holding both is its own book, not an
arb. `bestBid`/`bestAsk` ignore null/≤0 legs; `dispersionBps` needs ≥2 priced venues.
Served `GET /api/venue-arb`, ranked by `dispersionBps`.

> **Nuance — two "arb" implementations:** the shared `computeVenueArbRow` (powers the
> XARB *board*) enforces the different-venue guard; the older web `computeArb`
> (arb.ts:38, single-symbol ARB panel) computes `spread` from best bid/ask **without**
> that guard and reports `spreadPct` (×100) instead of bps. If you change one, check
> whether the other should match.

### 5c. OI concentration — `computeOiConcentration` (§4). Ranked by `totalOiValue`.

All three: a per-symbol upstream read that throws just drops that symbol (market.ts:73-77);
rows survive only if their signal field is non-null (market.ts:81).

---

## 6. Order books & microstructure

**`OrderBook`** (market.ts:88-97): `bids` best (highest) first, `asks` best (lowest)
first, `timestamp` epoch ms. A **level** is `{price, amount}` (amount in base units).

**Market-quality metrics** (`liquidity`, liquidity.ts:29-46):
- `mid = (bestBid + bestAsk) / 2`
- `spread = bestAsk − bestBid` (absolute); `spreadBps = spread / mid × 10_000`
- `depthNotional(levels, n) = Σ price×amount` over the top `n` levels (liquidity.ts:21) →
  `bidDepth` / `askDepth` / `totalDepth` (resting **quote notional**).
- Returns `null` when the book isn't two-sided (liquidity.ts:32).

**Post-trade slippage** (postTradeSlippage.ts:42): `slippageBps(side, est, realized)` —
**signed so positive is always WORSE for the trader** (a buy filled above estimate, or a
sell filled below). Baseline exists only in the browser that placed the order, so it is
honestly best-effort (fills elsewhere have no baseline). This is read-only observation;
it does not imply Midas trades.

---

## 7. Liquidations — the events, the side trap, and the underreporting problem

A **liquidation** is a forced close of a leveraged position by the exchange when margin
is exhausted. Midas models a single event as **`Liquidation`** (market.ts:227-235) and
the market-wide, symbol-tagged form as **`LiquidationEvent`** (market.ts:237-246, adds
`symbol` and `value = price × amount`, the quote notional).

**The side trap (recurring bug — get it right):** the `side` is the side of the
liquidation *order the exchange fires*, which is **opposite** the position:

| `side` | What was liquidated | Aggregated as |
|---|---|---|
| `'sell'` | a **long** (force-sold) | `longValue` / `longCount` |
| `'buy'` | a **short** (force-bought) | `shortValue` / `shortCount` |

Ground: market.ts:229; `summarizeLiquidations` (liquidations.ts:15-37) and its test
(liquidations.test.ts:15). `summarizeLiquidations` splits a feed into long/short notional
+ counts. Served market-wide at `GET /api/liquidations` (top-N perps merged newest-first,
capped 120; market.ts:266-294).

**ccxt normalization gotcha (ccxt.ts:394-405):** ccxt's unified liquidation shape has
**no top-level `side`** — it lives venue-specifically inside `info.side`. The reader
takes `l.side ?? l.info?.side`, and **drops** any row whose side or price can't be
determined rather than defaulting to `'buy'` (which would render every liquidation as a
short). Match this discipline if you touch it.

### The liquidation-underreporting problem (the trust wedge)

This is the domain fact that motivates the whole honest-derivatives campaign. Exchange
liquidation feeds are **the least trustworthy data in crypto**:

- Most venues expose **no public liquidation stream**, or **throttle it to ~1/sec**,
  which is widely documented to **under-report true liquidations many-fold**.
  Ground: market.ts:248-257 (contract doc) and ccxt.ts:415-421 (the honest `note`).
- **Binance removed its public liquidation stream in 2021** (market.ts:254, ccxt.ts:419);
  on the default exchange the feed silently returns nothing.
- Reported magnitude of the gap — **~6–20×**, with a cited example of an exchange's
  internal **$2.1B vs $333M shown** (Bybit CEO, cited in
  docs/research/2026-strategy-and-roadmap.md:106-111). **Attribute this as a cited
  research claim, not a repo-measured number.**

Midas's response is *honesty, not a fake fix*: `liquidationsProvenance()`
(ccxt.ts:415-421) reports `source`, `available`, and a `note` spelling out the throttle/
absence; the mock feed is flagged `synthetic: true` so it shows "demo", never "live"
(mock/derivatives.ts:67-73). **Never present a single exchange's liquidation feed as
ground truth, and never relabel synthetic as live.** The measurable, cross-source path to
actually improving this is owned by **midas-honest-derivatives-campaign**; the labeling
mechanics (unions, `note`, live/synthetic/unavailable) are owned by
**midas-data-honesty-and-provenance**. This skill owns only the *domain definitions*.

---

## 8. Cross-venue reads: how funding/OI are fetched & normalized

`getVenueDerivatives(symbol)` (ccxt.ts:326-358) is the fan-out feeding §5a/§5c. Per
compare-venue it does a **sequential** `readFunding` then `readOpenInterest`
(ccxt.ts:333-341), then keeps any venue that answered *any* perp field (funding, OI,
mark, or next-funding) and drops all-null spot-only venues (ccxt.ts:351-357).

- `readFunding` (helpers.ts:136-150): `fetchFundingRate` only; `nextFundingTime =
  fundingTimestamp ?? nextFundingTimestamp`; all-`null` on missing endpoint or throw
  (a spot-only venue degrades a field, never throws up the stack).
- `readOpenInterest` (helpers.ts:156-168): `fetchOpenInterest` only; base + notional.
- Both are **READ-ONLY** — no write method is ever called. Errors are sanitized via
  `safeErrorLabel` (helpers.ts:23) because a raw ccxt error can leak the signed request
  URL / API key.

The **mock/demo** twins generate cross-venue spreads deterministically (each venue funds
slightly differently via a seeded PRNG): `mockVenueDerivatives` / `mockDerivatives`
(mock/derivatives.ts:12-65). Funding ≈ `gaussian × 0.0001`, mark ≈ `mid × (1 ± 0.0003)`.
This is why demo↔server fidelity holds — same `compute*` helpers, same shapes.

---

## 9. Solana / DEX read basics (as implemented)

Midas's on-chain surface is **read-only and non-custodial by construction** — public
addresses and public RPC reads only; **it never signs or sends a transaction** (no write
path exists). All snapshots carry the same honesty labeling as market data.

- **`OnChainProvenance` / `SolanaProvenance`** = `'live' | 'synthetic' | 'unavailable'`
  (market.ts:286, solana.ts:8). Every metric is nullable so a partial read degrades a
  field, not the panel.
- **`DexPools` / `DexPool`** (market.ts:288-312): per-pool `priceUsd`, `liquidityUsd`
  (TVL), `volume24hUsd`, `feeBps` (swap fee tier in bps, e.g. 5/30/100). Live only when
  an on-chain source is configured (`MIDAS_DEX_SOURCE`, owned by config skill); otherwise
  honestly `unavailable` (ccxt.ts:423-434).
- **Base-58 case sensitivity (invariant #3):** Solana addresses/mints are base-58 and
  **case-sensitive** — preserve case exactly (solana.ts:74, 201; never upper/lowercase a
  mint like you would a ticker).
- **`SolanaSwapQuote` is QUOTE-ONLY** (solana.ts:233-269) — a price estimate from
  Jupiter, `slippageBps` in basis points; Midas fetches it but **never builds/signs/sends
  the swap**, so the "exactly two exchange writes" invariant is untouched.
- **SPL token safety headline** (solana.ts:186-223): `mintAuthorityActive` (supply can
  still be inflated) and `freezeAuthorityActive` (accounts can be frozen) — each `null`
  once revoked. Holder count is intentionally absent (needs an indexer, not RPC — Midas
  won't guess).

DEX price disagreement / arb uses the same bps/pct conventions as CEX (§0).

---

## 10. Where each metric is surfaced (quick map)

| Domain metric | Compute fn (file:line) | Route / panel |
|---|---|---|
| Perp snapshot (funding/OI/mark/index/liqs) | `getDerivatives` ccxt.ts:360 | `/api/derivatives/:symbol` (DERIV) |
| Funding board (top-N) | route-composed market.ts:214 | `/api/funding` (FUNDING) |
| Funding dispersion (arb) | `computeFundingDispersion` market.ts:389 | `/api/funding-dispersion` (FUNDX) |
| Funding history stats | `summarizeFunding` fundingHistory.ts:22 | `/api/funding-history/:symbol` |
| Funding carry P&L | `projectFunding` fundingPnl.ts:38 | FundingPnl panel |
| Basis / premium | `computeBasis` basis.ts:33 | BASIS panel |
| Cash-and-carry | `computeCarry` carry.ts:37 | FundingCarry panel |
| Venue price arb | `computeVenueArbRow` market.ts:155 | `/api/venue-arb` (XARB); `computeArb` arb.ts:38 (ARB) |
| OI concentration | `computeOiConcentration` market.ts:461 | `/api/oi-concentration` (OI) |
| Venue funding/OI summary | `summarizeVenueDerivatives` venueDerivatives.ts:26 | `/api/venue-derivatives/:symbol` |
| Market-wide liquidations | `summarizeLiquidations` liquidations.ts:15 | `/api/liquidations` (LIQ) |
| Order-book quality | `liquidity` liquidity.ts:29 | Liquidity panel |
| On-chain / DEX pools | `getDexPools` ccxt.ts:423 | `/api/onchain/:symbol` |

(Panel codes are indicative; the authoritative `ModuleCode`↔route map is owned by
`midas-architecture-contract`. Generic portfolio/risk metrics — Sharpe, Sortino, drawdown,
etc. — also live under apps/web/src/lib but are **out of scope** for this crypto-
derivatives pack.)

---

## 11. Domain pitfalls (the ones that actually bite here)

1. **Units.** `Candle.time` is **seconds**; almost every other timestamp is **ms**
   (§0). `fundingRate` is a **fraction**, not a percent — don't display it raw as "%".
   `openInterest` (base) ≠ `openInterestValue` (quote notional).
2. **bps vs pct.** Cross-venue spreads and order-book spread are **bps (×10_000)**;
   premium/APR/day-change are **pct (×100)**. 1% = 100 bps.
3. **Liquidation side is inverted** vs the position: `sell` = long liquidated (§7). And
   read side from `info.side`, dropping undeterminable rows (ccxt.ts:394-405).
4. **8h funding is an assumption** in the annualizers (§2). Wrong for 1h/4h venues.
5. **Single-venue liquidation feeds under-report ~6–20× and Binance has none** (§7).
   Never treat one feed as truth; keep the honest `note`.
6. **The cross-venue spread needs different venues** — `computeVenueArbRow` guards this
   (market.ts:179); a single venue's own bid/ask spread is not an arb.
7. **`null` means "no data", never 0.** `tickerPrice` returns `null` (not 0) when a
   ticker has no usable price (helpers.ts:91-101) precisely so a fake 0 doesn't flow into
   compare rows / the screener / alerts as a real price. Preserve that.
8. **Solana base-58 is case-sensitive** (§9). Don't normalize a mint like a ticker.

---

## When NOT to use this skill

- **Labeling data live/synthetic/unavailable, the provenance unions, `note`, demo↔server
  fidelity** → `midas-data-honesty-and-provenance` (owns the mechanics; this skill only
  gives the *domain* reason a feed is untrustworthy).
- **The executable, decision-gated plan to actually improve honest cross-exchange
  funding/OI/liquidations** → `midas-honest-derivatives-campaign` (uses this skill's
  definitions; don't rebuild the campaign here).
- **Which module code maps to which route / how to register a panel / the DataProvider
  seam** → `midas-architecture-contract`.
- **Env var defaults (`MIDAS_CCXT_COMPARE`, `MIDAS_DEX_SOURCE`, `MIDAS_CCXT_EXCHANGE`)** →
  `midas-config-and-flags`.
- **Promoting a math change / adding a failing→passing test / the gates** →
  `midas-change-control` + `midas-validation-and-qa`.
- **Generic portfolio/quant metrics** (Sharpe, drawdown, VaR…) — not this pack.

---

## Provenance and maintenance

All facts verified against the repo on **2026-07-19** (Midas `0.5.0`,
`MIDAS_VERSION` system.ts:12). Volatile items + one-line re-verify commands:

| Fact (as of 2026-07-19) | Re-verify |
|---|---|
| The 3 shared compute helpers at market.ts **155 / 389 / 461** | `grep -n "export function compute" packages/shared/src/market.ts` |
| Funding stored as fraction; OI base vs `openInterestValue` quote | `grep -n "fraction (0.0001\|base units\|notional in quote" packages/shared/src/market.ts` |
| Funding annualizer = ×1095 for 8h (`DEFAULT_FUNDINGS_PER_YEAR`) | `grep -n "1095\|24 / intervalHours" apps/web/src/lib/basis.ts apps/web/src/lib/funding.ts` |
| Liquidation side: `'sell'`=long, `'buy'`=short | `grep -n "was liquidated" packages/shared/src/market.ts` |
| Herfindahl = Σ(share²) | `grep -n "herfindahl" packages/shared/src/market.ts` |
| Underreport / throttle / Binance-2021 note strings | `grep -n "under-report\|throttl\|2021" packages/shared/src/market.ts apps/server/src/providers/ccxt.ts` |
| ccxt liq side read from `info.side`, drops undeterminable | `sed -n '384,410p' apps/server/src/providers/ccxt.ts` |
| readFunding / readOpenInterest normalization | `grep -n "fetchFundingRate\|fetchOpenInterest\|openInterestAmount" apps/server/src/providers/ccxt/helpers.ts` |
| Compare-set default (owned by config skill) | `grep -n "MIDAS_CCXT_COMPARE" apps/server/src/providers/ccxt.ts` |
| Shared compute helpers pass their tests | `pnpm --filter @midas/server test venueArb fundingDispersion oiConcentration` |
| Web domain math passes its tests | `pnpm --filter @midas/web test basis funding fundingPnl carry liquidations liquidity arb` |

If a re-verify command's output diverges from a claim above, **the code is right** —
update this skill. The ~6–20× / $2.1B-vs-$333M figures are **cited research claims**
(docs/research/2026-strategy-and-roadmap.md:106-111), not repo-measured — re-verify
against a current source before quoting them externally.
