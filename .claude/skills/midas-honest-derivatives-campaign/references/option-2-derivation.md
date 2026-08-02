# Option 2 derivation — cross-venue liquidation fan-out

Gate 1 of `midas-honest-derivatives-campaign`, Option 2. Option 1 (per-source
coverage, staleness, throttle) shipped in PR #352; this closes M1's aggregate
side and M2. Measured 2026-08-02 against `2f82d5f`.

## The bug Option 1 documented but did not fix

Option 1 made the gap visible: a stock install rendered `1 of 6 venues sampled ·
0 reporting`. It could not fix it, because `/api/liquidations` still read one
venue. Worse, the *gate* was wrong: `liquidationsProvenance().available` was
`this.exchange.has['fetchLiquidations']` — the **primary venue only**. With the
default `MIDAS_CCXT_EXCHANGE=binance`, that returned false and the route skipped
the read entirely, so venues in the compare set that *do* publish were never
asked. Availability is now a property of the configured **set**.

## 1. Union, not average, and never deduplicated

The core derivation, and the one most likely to be got wrong by analogy to the
existing venue boards.

**Liquidations are not price.** `computeVenueArbRow` takes N venue quotes of one
asset — N observations of a single quantity — and reduces them to *dispersion*.
Summing them would be meaningless. Liquidations invert this: each venue's
liquidations are **its own disjoint real events**. A position closed on OKX is a
different position from one closed on Bybit. The honest cross-venue reduction is
therefore a **union/sum**.

Two failure modes are fenced by tests:

- **Averaging** understates the market by a factor of the venue count. Three
  venues each reporting one $100 liquidation is $300 of liquidations, not $100.
- **Deduplicating** "similar" events across venues silently deletes real ones.
  Two identical-looking liquidations at the same instant on two venues are two
  real liquidations. There is no cross-venue identity to dedup on, and inventing
  one destroys evidence.

Both are asserted directly (`does not deduplicate identical-looking events across
venues`, `sums disjoint venue events rather than averaging them`).

**The union is still a lower bound.** Every contributing feed is independently
throttled and documented to under-report, so a union of under-reports
under-reports. `multiple` measures recovery against *one venue*, never against
the market.

## 2. M2 — the aggregate-vs-single-source multiple

`multiple = totalValue / referenceValue`, where `referenceSource` is the
provider's primary venue: literally what a single-source feed would have shown.

Three cases, each a distinct honest answer rather than a fallback:

| Case | Result | Why |
|------|--------|-----|
| Reference reported, others too | `multiple > 1` | The recovery, labeled a lower bound |
| Only the reference reported | `multiple === 1` | The single-source baseline, unchanged |
| Reference reported **nothing** | `multiple === null` | No finite ratio exists. Never `Infinity` — "the primary published nothing" is not "infinitely better coverage" |
| Reference not in the fan-out | `multiple === null`, `referenceValue === null` | Not sampled ≠ sampled-and-zero |

The third case is the **default install**, so the UI does not hide it: the panel
renders `binance alone shows none` with the explanation that a single-source feed
would show an empty panel. Suppressing the row because the arithmetic is
undefined would bury the single most important finding.

## 3. Fan-out cost — bounded by capability, not by policy

The naive worry is `symbols × venues` upstream reads (30 × 6 = 180). Three things
bound it, in order of effect:

1. **Capability gating.** A venue that does not declare `fetchLiquidations`
   returns `available: false` with **zero network cost** — `has[...]` is a static
   ccxt declaration. On the default compare set most venues are in exactly that
   state, so the real multiplier is small, and it is the venues with data that
   cost anything.
2. **The single-flight TTL.** `LIQUIDATIONS_TTL_MS = 15_000` already collapses
   concurrent callers and the panel's 8s poll onto one sweep, the same pattern
   `registerVenueBoard` uses for the funding/OI/arb boards.
3. **The limit clamp**, lowered from 60 to 30 to match the cross-venue boards.
   This route now has their cost shape, so it takes their bound. The web client
   requests 30, so the default view is unaffected.

`Promise.allSettled` per venue: one dead venue degrades to `available: false` and
shows up as reduced coverage. Losing five good venues because a sixth timed out
would be the opposite of honest. Only an all-venue failure throws.

## 4. Event tagging

`LiquidationEvent.source` is set for every event in an aggregate. An untagged
event in a merged cross-venue stream cannot be attributed, audited, or excluded
— the field is optional only so single-source feeds stay back-compatible.

## 5. What this still does NOT claim

- **No "actual" volume.** Unchanged from Option 1: there is no public source of
  true liquidation volume. No 6-20x correction factor exists anywhere in the code
  (Wrong Path #3, and Option 5 stays rejected).
- **No claim the gap is closed.** The M2 copy is asserted *not* to contain
  "actual", "true volume", or "complete".
- **No config changes.** `MIDAS_CCXT_*` untouched.
- **Option 4 (heatmap + history) still deferred** — it needs the persistence
  seam and is its own campaign.

## Measured results

| id | Metric | Before (post-Option-1) | After |
|----|--------|------------------------|-------|
| M1 | Source coverage | 1/6 sampled, 0/6 reporting on a default install | Every capable venue sampled; mock fixture measures 6 configured / 6 sampled / 4 reporting = 0.67 |
| M2 | Aggregate-vs-single multiple | absent | present, tested across all four cases, rendered as a labeled lower bound |
| M3 | Per-source staleness | present | unchanged, now fed by real per-venue observations |
| M4 | Per-source throttle/availability | present | unchanged; feed-level `available` now reflects the configured set, not the primary |
| M5 | No synthetic-as-live | green | still green; mock and demo venues forced synthetic + un-throttled |

20 new tests fail on the pre-change source and pass on the new one (10 aggregate
helper, 2 route, 5 web view, 3 demo fidelity).

Gates: `pnpm test:reviewer` (9 pass), `check:repo-policy`, `check:governance`,
`pnpm typecheck` (3/3), `pnpm build`, `check-bundle.mjs` (149.6 KB main vs 155 KB
budget), `pnpm --filter @midas/web build:demo`, `pnpm test` — server 68 files/706
tests, web 252 files/2047 tests. All green.
