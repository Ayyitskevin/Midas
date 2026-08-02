# Option 1 derivation — structured per-source liquidation provenance

Written for Gate 1 of `midas-honest-derivatives-campaign`. The derivation is the
design; the failing→passing tests are the evidence. Measured 2026-08-02 against
`8169199`.

## Phase 0 baselines (measured, not assumed)

| id | Fact | Measured value |
|----|------|----------------|
| B1 | Liquidations meta shape | `LiquidationsProvenance` = `{source, available, synthetic?, note?, receipt?}`. The route test asserted only `meta.source`, `meta.available`, `meta.asOf`. No per-source array, no staleness, no throttle state. |
| B2 | Compare-set size **N** | **6** — `MIDAS_CCXT_COMPARE=binance,coinbase,kraken,bitfinex,okx,kucoin` (`.env.example:19`, `docker-compose.yml:21`) |
| B3 | Source coverage | **1/6 nominal**. `/api/liquidations` reads `provider.getDerivatives(symbol)` from the single configured exchange. With the default `MIDAS_CCXT_EXCHANGE=binance` — a venue that removed its public liquidation stream in 2021 — **effective coverage is 0/6** while the panel still reads as a live feed. |
| — | Server suite baseline | 67 files / 677 tests green |

The runbook's own baselines were stamped 2026-07-19 at 45 files / 368 tests. The
repo has moved; the asymmetry it describes has not.

## Drift that changes the derivation: the Data Trust Plane

A whole evidence layer (`docs/DATA_TRUST_PLANE.md`, `packages/shared/src/dataTrust.ts`)
landed after the campaign was written. It supplies the number the runbook asked
us to derive from first principles, so `STALE_MS` is read off existing evidence
rather than invented.

## 1. `STALE_MS` — derived, not chosen

`LIQUIDATION_SOURCE_MAX_AGE_MS = 60_000`.

It is the `maxAgeMs` the `liquidations` dataset family already declares in the
provider capability manifest, alongside `expectedCadenceMs: 1_000` — the
documented ~1/sec public-stream throttle (`apps/server/src/providers/ccxt.ts`,
`liquidations: conditional(..., 1_000, 60_000, [...])`).

Three independent checks say 60s is the right boundary rather than a round number:

1. **Against the cadence.** 60s is 60× the declared expected cadence. A venue
   publishing at its throttled rate emits many events per minute; one that emits
   nothing for a full minute has stopped publishing, not gone quiet between ticks.
2. **Against our own caching.** The panel polls at 8s (`LiquidationsModule.tsx`)
   and the route caches at `LIQUIDATIONS_TTL_MS = 15_000`. 60s sits well above
   both, so a `stale` label can never be an artifact of Midas's own latency.
3. **Against the trust plane.** Reusing the family's declared `maxAgeMs` keeps
   one freshness policy in the codebase instead of a second, divergent one.

It stays a parameter (`normalizeLiquidationsMeta(..., maxAgeMs)`) so the boundary
is testable at exactly the threshold rather than approximately near it.

## 2. "Throttled" — capability-derived, never count-derived

`throttled` is true when a venue **declares** a public liquidation feed
(`has['fetchLiquidations']`), and false otherwise. It is never a function of how
many events were observed.

Count-based inference fails in both directions: a genuinely quiet market would be
mislabeled "throttled", and a busy throttled feed would look complete. The claim
being made is *"this is a throttled public stream, so sizes are a lower bound"* —
that is a property of the venue, not of the sample.

Two capability-driven cases are forced to `throttled: false`:

- **No public feed** — there is no stream to throttle (`available: false`).
- **Synthetic** — fabricated events have no upstream stream at all.

Tested on all three capabilities (`M4`), including the adversarial pair: same
capability, 500 events vs 0 events, labels must not move.

## 3. `stale` is three-state, and unknown is never rounded to fresh

`stale: boolean | null`. It is `null` — explicitly unknown — in four cases:

| Case | Why not `false` |
|------|-----------------|
| Venue publishes no feed | Nothing to be fresh or stale about |
| Configured but not sampled | We did not look; we cannot claim |
| Sampled, produced zero events | A quiet market and a dropped feed are indistinguishable from here |
| Newest event ahead of our clock | Clock skew. The trust plane reports skew rather than clamping to a reassuring zero |

Collapsing any of these into `false` would be the synthetic-as-live bug wearing a
different hat: a confident label over evidence that does not support it.

## 4. Coverage — the ratio is surfaced, not summarized away

`coverage = { configured, sampled, reporting, ratio }` where
`ratio = reporting / configured` (**M1**).

- `configured` — venues the provider declares it can read (the honest denominator).
- `sampled` — venues actually read this sweep. Option 1 keeps this at 1.
- `reporting` — venues that returned ≥1 event.

A single-venue read presented as one aggregate number is the exact false
confidence this panel exists to prevent. On a stock install this now renders
`1 of 6 venues sampled · 0 reporting` instead of an empty panel with a live dot.

`ratio` is `null` when nothing is configured — never a fabricated `0/0`.

## 5. What this does NOT claim

- **No "actual" volume.** There is no public source of true liquidation volume;
  that unknowability *is* the product. No 6-20x fudge factor is applied anywhere
  (Wrong Path #3).
- **No M2 yet.** The aggregate-vs-single-source multiple needs the multi-venue
  fan-out (Option 2). Option 1 samples one venue and says so.
- **No cross-venue union yet.** When Option 2 lands, cross-venue liquidations
  must be **summed/unioned**, never averaged or deduped — each venue's
  liquidations are disjoint real events (Wrong Path #4).
- **No config changes.** `MIDAS_CCXT_EXCHANGE` / `MIDAS_CCXT_COMPARE` are
  untouched; humans own exchange config and deploy.

## Forward compatibility with Option 2

`computeLiquidationSourceStatuses(capabilities, observations, asOf, maxAgeMs)`
takes N observations. Option 1 passes one. Option 2 passes N without changing the
helper, its tests, the meta shape, or the panel — the fan-out becomes the only
new work.

## Measured results

| id | Metric | Before | After |
|----|--------|--------|-------|
| M1 | Source coverage ratio | not surfaced | `reporting/configured` in `meta.coverage`, rendered in the panel; 1/6 sampled on a default install |
| M2 | Aggregate-vs-single multiple | n/a | deferred to Option 2 (needs fan-out) |
| M3 | Per-source staleness | absent | present, frozen-clock tested, boundary flips exactly at `maxAgeMs` |
| M4 | Per-source throttle/availability | absent | present, capability-derived, tested on 3 capabilities |
| M5 | No synthetic-as-live | green | still green; synthetic forced through provider, route and panel |

23 new tests fail on the pre-change source and pass on the new one
(16 shared/helper, 2 route, 5 web view).

Gates: `pnpm test:reviewer`, `check:repo-policy`, `check:governance`,
`pnpm typecheck` (3/3), `pnpm build`, `check-bundle.mjs` (149.7 KB main vs 155 KB
budget), `pnpm --filter @midas/web build:demo`, `pnpm test`
(server 68 files/695 tests, web 252 files/2039 tests) — all green.
