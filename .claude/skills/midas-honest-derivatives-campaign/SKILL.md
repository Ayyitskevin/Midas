---
name: midas-honest-derivatives-campaign
description: >-
  The EXECUTABLE, decision-gated campaign for Midas's hardest live problem — the
  "honest cross-exchange derivatives" trust wedge: multi-source funding / OI /
  LIQUIDATIONS aggregation with per-source SOURCE + STALENESS + THROTTLE labels,
  because exchange liquidation feeds underreport true volume ~6-20x and no
  competitor labels this honestly. Load this when the task is to make the
  liquidations feed honest and cross-exchange, aggregate derivatives across
  venues, add per-source staleness/throttle state, close the gap where
  funding/OI/arb are multi-venue but /api/liquidations is single-source, or
  advance the roadmap's N2/N3 "cross-exchange aggregation + honest liquidations"
  work. Triggers: "honest liquidations", "cross-exchange derivatives", "liquidations
  underreport / 6-20x", "aggregate funding/OI/liqs across venues", "per-source
  staleness label", "throttle label", "trust wedge", "make the liq feed honest",
  "single-exchange liquidations", "registerVenueBoard for liquidations",
  "liquidationsProvenance", "/api/liquidations", "reported vs actual liquidation
  volume". This is a phased runbook with measurable gates; it routes promotion
  through midas-change-control and borrows domain math from crypto-market-reference
  and labeling mechanics from midas-data-honesty-and-provenance.
---

# Campaign: Honest cross-exchange derivatives (the liquidations trust wedge)

You are executing the owner's hardest, highest-value problem. This is a **runbook**,
not an essay. Follow the phases in order. Every gate tells you the number to expect
and where to branch if you see something else. **Do not judge success by eye** — every
claim of "done" is a measured number or a failing→passing test.

## The one-paragraph problem statement (verified)

Midas already aggregates **funding, open interest, and price** across venues: the
funding-dispersion / venue-arb / OI-concentration boards fan a per-symbol read out
across the *compare set* and reduce it with a pure `compute*` helper
(`apps/server/src/routes/market.ts:242-261`, `packages/shared/src/market.ts:155,389,461`).
**Liquidations do not.** `/api/liquidations` (`routes/market.ts:266-294`) reads one
provider's `getDerivatives(symbol).recentLiquidations` per top-N symbol — and the ccxt
provider reads liquidations from `this.exchange` **only** (`providers/ccxt.ts:360-410`),
never fanned across `getCompareExchanges()` the way `getVenueDerivatives` is
(`providers/ccxt.ts:326-358`). Its provenance is a single flat object
`{ source, available, note }` (`providers/ccxt.ts:415-421`) stamped with one `asOf`
(`routes/market.ts:291`). There is **no structured per-source staleness or throttle
state anywhere in the contract** (verified: only `Quote.asOf` mentions "staleness"
in `packages/shared/src/market.ts`). Meanwhile the category's open secret is that
exchange liquidation WebSockets are throttled to ~1/sec and **underreport 6-20x**
(`docs/research/2026-strategy-and-roadmap.md:106-112`; Bybit's CEO: $2.1B internal vs
$333M shown ≈ 6.3x), and the **default** primary exchange (Binance) removed its public
liquidation stream in 2021 — so a stock Midas install shows an empty-or-thin
liquidations panel that *looks* live. The campaign closes this gap **honestly**.

> Domain terms (perp, funding, OI, liquidation side, notional, bps, Herfindahl):
> **do not guess** — `crypto-market-reference` owns them with exact in-repo units.
> Provenance mechanics (the `live | synthetic | unavailable` unions, `live` vs
> `streamLive`, the LIVE/SIM badge rules, the demo↔server fidelity contract):
> **do not restate them** — `midas-data-honesty-and-provenance` owns them.

---

## Phase 0 — Orient and establish the baselines (read-only, ~10 min)

You cannot know if you improved anything without the starting numbers. Record them.
Run from repo root `/home/user/Midas`.

**Step 0.1 — Confirm the asymmetry is still real (code may have moved).**
```bash
grep -n "registerVenueBoard\|getVenueDerivatives\|getExchangeQuotes" apps/server/src/routes/market.ts
grep -n "getDerivatives\|liquidationsProvenance" apps/server/src/routes/market.ts
grep -n "liquidationsProvenance" apps/server/src/providers/ccxt.ts
```
EXPECT: the three venue boards call `provider.getVenueDerivatives` / `getExchangeQuotes`
(multi-venue); `/api/liquidations` calls `provider.getDerivatives(...).recentLiquidations`
(single-provider) and `provider.liquidationsProvenance()` returns one `{ source, available, note }`.
- **If `/api/liquidations` already fans out across venues or `liquidationsProvenance`
  already returns an array/`sources` field → branch:** part of this campaign already
  shipped. Re-scope: read what exists, re-measure the baselines below against it, and
  jump to the first unmet success metric (Phase 6 checklist). Do not rebuild.

**Step 0.2 — Baseline the test suite is green (your safety net).**
```bash
pnpm --filter @midas/server exec vitest run
```
EXPECT (2026-07-19): `Test Files 45 passed (45)`, `Tests 368 passed (368)`.
- **If red or the command errors (missing deps, tsx, lockfile) → branch to
  `midas-build-and-env`** (env recreation + the exact CI gate order). Do not proceed
  on a red baseline — you will not be able to tell your change from the pre-existing break.

**Step 0.3 — MEASURE the single-source liquidations baseline (do not assume).**
The current `/api/liquidations` meta shape and the compare-set size are the two numbers
every later gate compares against. The app-test harness builds the app on the **mock**
provider (`apps/server/src/app.test.ts:8-12`).
```bash
# (a) What the liquidations feed meta carries TODAY:
grep -n "meta.source\|meta.available\|meta.asOf\|feed.meta" apps/server/src/app.test.ts
sed -n '135,155p' apps/server/src/app.test.ts
# (b) The compare-set size N (the denominator of coverage) — READ it, don't hardcode:
grep -n "MIDAS_CCXT_COMPARE" .env.example docker-compose.yml apps/server/src/providers/ccxt.ts
```
RECORD three baseline numbers:
- **B1 (meta shape):** the existing route test asserts only `meta.source`,
  `meta.available`, `meta.asOf` exist — **no per-source array, no `staleness`, no
  `throttled`**. This is the honesty gap in one line.
- **B2 (compare-set size N):** count the venues in `MIDAS_CCXT_COMPARE`
  (env var — its default is owned by `midas-config-and-flags`; read the current value,
  don't memorize one). Call it **N**.
- **B3 (source coverage):** liquidations sample exactly **1** source today →
  baseline coverage = **1 / N**. If the default primary is Binance, the 1 sampled
  source publishes **no** public feed → effective real coverage = **0 / N**.
- **If B1 already shows a per-source array → you are in the "already shipped" branch
  (see 0.1).** If N is unreadable (env not set, default in code differs) → cite the
  code default in `getCompareExchanges` (`providers/ccxt.ts:919-938`) as N and move on.

**Step 0.4 — Read the external evidence you are acting on (so you defend it correctly).**
```bash
sed -n '106,131p' docs/research/2026-strategy-and-roadmap.md
sed -n '248,283p' packages/shared/src/market.ts
```
This is the "why". You will cite `2026-strategy-and-roadmap.md:106-112` (the 6-20x /
$2.1B-vs-$333M claim) and the contract's own `LiquidationsProvenance` doc-comment
(`market.ts:248-271`) in the PR. **These are external / documented claims, not repo
ground truth** — see the measurable-success section for what you can actually prove here.

**Phase 0 exit gate:** you can state, in numbers, (B1) the meta gap, (B2) N, and
(B3) coverage = 1/N. If you cannot, do not start Phase 1.

---

## The measurable-success contract (read before choosing a solution)

The owner's success bar is *"reported-vs-actual liquidation volume across sources;
per-source staleness/throttle state surfaced and correct."* **There is no public
source of TRUE ("actual") liquidation volume** — that unknowability *is* the problem.
So "actual" is never a number you print. You prove success with five measured,
test-backed quantities. Each gate below references these by id.

| id | Metric | How to MEASURE (deterministic, never by eye) | Baseline | Target |
|----|--------|----------------------------------------------|----------|--------|
| **M1** | Source coverage ratio | (# compare venues that returned ≥1 liq event) ÷ N, from the feed meta; unit test on a fixture with K publishing + (N−K) empty venues asserts `coverage === K/N` | 1/N (Phase 0 B3) | > 1/N; and the ratio is *surfaced*, not hidden |
| **M2** | Aggregate-vs-single-source multiple | Σ event.value over all sources ÷ Σ event.value from the single default source, on a fixed fixture | 1.0 | > 1.0, **labeled a throttled lower bound — never "the recovered 6-20x"** |
| **M3** | Per-source staleness correctness | freeze the clock; feed each source a known `lastEventAt`; assert `ageMs === asOf − lastEventAt` and `stale === (ageMs > STALE_MS)` flips exactly at the threshold | none exists (B1) | present + test flips at boundary |
| **M4** | Per-source throttle/availability correctness | for a source of known capability, assert `available`/`throttled` map from the provider's real capability (ccxt `has['fetchLiquidations']` + known-throttle list), not from event count | none exists (B1) | present + tested on ≥2 capabilities |
| **M5** | No synthetic-as-live regression | existing + new honesty tests: mock/demo sources keep `synthetic:true`; the panel never renders green LIVE over them | green today | still green |

Rules that make these honest (violating one fails review):
- **"Actual" is unknowable → never fabricated.** M2 is a *lower bound*; label it so.
  Missing data → `unavailable`, never an invented or scaled number (invariant #1).
- **STALE_MS and the "throttled" definition are DERIVED, not eyeballed** (see the
  solution menu — each option owes this derivation before code).
- Judge every metric by a **frozen-clock unit test** on a fixture, not by opening the
  panel. `midas-proof-and-analysis` owns the measurement-recipe + adversarial-verification
  discipline; use it to have a skeptic try to refute each metric.

---

## The ranked solution menu (pick from the top; each option owes its theory FIRST)

Attempt these **in order**. Each carries the derivation it must produce *before* any
code — write the derivation into the PR description / a `references/` note; the
derivation is the design, the **test** is the evidence (`midas-change-control`:
"generated prose is not evidence").

**Option 1 — Structured per-source provenance (contract + labels). START HERE.**
Extend the contract from one flat `LiquidationsProvenance` to a per-source status array
(`sources: LiquidationSourceStatus[]` with `{ source, available, throttled, synthetic?,
lastEventAt, ageMs, stale }`), and stamp it in the route + render it in the panel.
Keep the feed single-source for this option — but **label it honestly** ("1 of N venues
sampled; Binance publishes no public feed"). Lowest risk, small surface, immediately
closes the M3/M4 honesty gap.
- **Owes:** (a) a *derivation of `STALE_MS`* — tie it to the documented throttle
  cadence (~1/sec) and the feed's own poll/TTL, not a round number pulled from air;
  (b) a *precise definition of "throttled"* — map it to the provider's real capability
  (`has['fetchLiquidations']` + a named known-throttle list), never to "few events";
  (c) a *no-synthetic-as-live proof* (M5).

**Option 2 — Multi-source fan-out aggregation (the real fix). DO AFTER Option 1.**
Add a **pure** `computeLiquidationsAggregate(perSource)` in `packages/shared/src/market.ts`
(mirror `computeOiConcentration`'s shape/tests), fan `/api/liquidations` across
`getCompareExchanges()` exactly like `getVenueDerivatives`, tag each event with its
source, union them, and compute M1 coverage + M2 multiple + per-source M3/M4. Highest
value (this is roadmap N2+N3), medium risk (more surface, live fan-out cost).
- **Owes:** (a) the **union-not-average derivation** — each venue's liquidations are
  *its own* distinct events, so the cross-venue aggregate is a **union/sum** (unlike
  *price*, which you never sum, and unlike a single book you never double-count);
  state why dedup across venues is wrong (drops real events) and why summing one
  throttled feed and calling it "total" is also wrong (M2 lower-bound); (b) the
  **coverage-ratio definition** (M1); (c) the **fan-out cost / TTL** analysis — reuse
  the `registerVenueBoard` single-flight TTL pattern (`routes/market.ts:47-85`,
  `FUNDING_DISPERSION_TTL_MS`) so N×M reads are bounded; (d) `Promise.allSettled`
  degrade-per-venue (a dead venue drops to `available:false`, never fails the feed).

**Option 3 — Surface the reported-vs-single-source multiple (M2) in the UI.**
Show "aggregating K sources shows X× the single-source volume — still a throttled lower
bound". Small, but it is the literal "reported-vs-actual across sources" deliverable.
- **Owes:** the lower-bound labeling proof (it is **not** "actual"); reuse the honesty
  banner already in `LiquidationsModule.tsx:47-59`.

**Option 4 — Liquidation heatmap + history (time-bucketed, persisted). DEFER (LATER bet).**
Roadmap lists heatmaps + history as part of the wedge, but persistence routes into the
single-writer file-backed seam (or the documented DB-adapter swap — the engine is unnamed
in the repo; `midas-research-frontier` labels a specific engine a CANDIDATE, not a
committed decision). **Do not start until Options 1-2 ship.**
- **Owes:** a bucketing scheme + a persistence design that respects the storage seam
  (see `midas-run-and-operate` / `midas-architecture-contract`). Its own campaign.

**Option 5 — (REJECTED — listed only to fence it) Scale the single feed by a fixed
6-20x factor to "correct" underreporting.** Forbidden: it fabricates a value. See Wrong
Path #3.

---

## Wrong paths — fenced off with evidence (re-read before every commit)

| # | Tempting wrong move | Why it is wrong | Evidence |
|---|---------------------|-----------------|----------|
| **1** | **Trust a single exchange's liquidation feed as ground truth** (rank, alert, or headline off one venue's absolute volume) | Feeds are throttled ~1/sec and underreport **6-20x**; the default primary (Binance) publishes **no** public feed since 2021 — a stock install ranks off ~0 real data while looking live | `docs/research/2026-strategy-and-roadmap.md:106-112`; `packages/shared/src/market.ts:248-257`; `providers/ccxt.ts:415-421` |
| **2** | **Show an aggregated number without per-source staleness/throttle labels** | Violates data-honesty invariant #1; an aggregate that hides that N−1 of N sources are stale/absent manufactures false confidence | invariant #1 (`REFACTOR_PLAYBOOK.md` Part 1); `market.ts:248-271`; owned by `midas-data-honesty-and-provenance` |
| **3** | **Multiply the reported number by a 6-20x fudge factor to estimate "actual"** | Fabricates a value; "actual" is unknowable. Missing data → `unavailable`/lower-bound, never invented or scaled | invariant #1 "never a fabricated number, never a stale value silently re-labeled" |
| **4** | **Average or dedup liquidation notional across venues (as you would price)** | Each venue's liquidations are *disjoint real events* — the honest cross-venue view is a **union/sum**, not a mean; dedup drops real events, averaging understates | contrast `computeVenueArbRow` (price → dispersion, never summed) vs the union needed here; `crypto-market-reference` |
| **5** | **Relabel mock/demo liquidations as live to fill an empty panel** | The #1 recurring bug class (synthetic shown as live); mock/demo must stay `synthetic:true` and render SIM/demo | `providers/mock/derivatives.ts:67-74`; `apps/web/src/demo/engine.ts:404-413`; `midas-data-honesty-and-provenance` |
| **6** | **Bundle this with an unrelated fix, or flip `MIDAS_CCXT_EXCHANGE`/compare config as "part of" the code change** | Breaks single-concern PR discipline and the "don't change exchange config in a code change" rule | `midas-change-control` (single-concern draft PR; humans own config/deploy) |

---

## Phase 1 — Decide the target and write the theory (gate: derivation exists)

1. Pick from the menu — default is **Option 1, then Option 2**; defer 4.
2. Produce the owed derivation (STALE_MS, "throttled" definition, union-not-average,
   coverage/lower-bound) as a short design note. Keep it in the PR body or
   `references/` inside this skill folder — **never** mutate other repo files for notes.
3. Sanity-check scope with `midas-change-control`: this is a **behavioral data-surface
   change** → it needs a failing→passing test and rides one single-concern draft PR.
   Touching a market data surface also makes `midas-data-honesty-and-provenance`'s
   labeling checklist mandatory (server route + web badge + demo shim must agree).

**Gate 1:** the derivation names an explicit `STALE_MS` value with a *reason*, and a
*capability-based* (not count-based) definition of "throttled".
- **If you cannot justify STALE_MS from the throttle cadence + poll interval → branch:**
  measure the poll interval first (`LiquidationsModule` uses `intervalMs: 8000`,
  `apps/web/src/modules/LiquidationsModule.tsx:11-15`; the funding/OI TTLs are 20-45s,
  `routes/market.ts:33-38`) and derive from those, not a guess.

---

## Phase 2 — Extend the contract in @midas/shared (gate: typecheck across BOTH tiers)

Add the per-source status type next to `LiquidationsProvenance`/`LiquidationsMeta`
(`packages/shared/src/market.ts:258-283`). `@midas/shared` is consumed as **raw TS by
both** the server and the web/demo, so a shape change moves both tiers at once
(that is by design — see `midas-architecture-contract`). Keep shared **dependency-free**
(invariant #6): pure types + a pure helper only, no imports.

```bash
pnpm -r typecheck
```
EXPECT: three packages typecheck clean **if** you kept the old fields as a superset, or
a bounded list of consumer errors **if** you changed an existing field's shape.
- **If the web app throws dozens of type errors on `meta.source` → EXPECTED** for a
  shape change: fix each consumer (`api.ts`, `LiquidationsModule.tsx`, `lib/liquidations.ts`,
  `demo/engine.ts`). That is the shared-contract fan-in doing its job.
- **If a typecheck error points into `packages/shared` importing something → branch:**
  you added a dependency to shared. Remove it (invariant #6). Compute stays pure.

---

## Phase 3 — Pure helper + frozen-clock unit test (gate: M3/M4 measured)

This is where the measurable success lives. Model the test on the existing compute-helper
tests (`apps/server/src/fundingDispersion.test.ts`, `oiConcentration.test.ts`,
`venueArb.test.ts` — the shared package itself has no test runner; its helpers are tested
from the server package via the `@midas/shared` alias, `apps/server/vitest.config.ts:7`).

Write a **failing→passing** test that:
- freezes a clock and feeds fixtures with known `lastEventAt` per source → asserts
  `ageMs` and the `stale` boundary flip (**M3**);
- feeds sources of known capability (available, no-feed, synthetic) → asserts
  `available`/`throttled`/`synthetic` (**M4**);
- feeds K publishing + (N−K) empty sources → asserts coverage `=== K/N` (**M1**) and
  the aggregate value multiple (**M2**).

```bash
# name the new file e.g. apps/server/src/liquidationsAggregate.test.ts
pnpm --filter @midas/server exec vitest run liquidationsAggregate
```
EXPECT: the new file runs in isolation and passes (compare the run shape to the verified
`fundingDispersion` focused run: `Test Files 1 passed (1)`).
- **If `vitest run <name>` runs the WHOLE 45-file suite instead of one file → you used
  the wrong form.** `pnpm --filter <pkg> test -- <name>` does **not** forward the
  filter; use `pnpm --filter @midas/server exec vitest run <pattern>` (verified
  2026-07-19). Web equivalent: `pnpm --filter @midas/web exec vitest run <pattern>`.
  (This is the canonical focused form, owned by `midas-validation-and-qa`.)
- **If the stale boundary test passes at every threshold → your clock isn't frozen:**
  inject `now`/`asOf` as parameters (mirror `createTtlCache(ttl, () => clock)` in
  `fundingDispersion.test.ts:60-74`); never call `Date.now()` inside a pure helper you
  need to test deterministically.

**Gate 3:** M1, M3, M4 (and M2 if doing Option 2) are each asserted by a test that
**fails on the pre-change helper and passes on the new one**. No failing→passing pair →
`midas-change-control` says it is not yet a proven fix.

---

## Phase 4 — Wire the route + update the route test (gate: feed carries per-source meta)

Option 1: stamp the structured per-source status into the feed `meta`
(`routes/market.ts:289-293`). Option 2: additionally fan the per-symbol read across
`getCompareExchanges()` — add a provider method (e.g. `getVenueLiquidations`) mirroring
`getVenueDerivatives` (`providers/ccxt.ts:326-358`), implement it on **every** provider
(ccxt real fan-out, mock synthetic, yahoo `unavailable`) or the mock/demo boards break,
and wrap the cost in the `registerVenueBoard` TTL pattern.

Update `apps/server/src/app.test.ts` (the `GET /api/liquidations` block at :135-155) to
assert the new per-source array + coverage + staleness fields — the current test only
checks `source`/`available`/`asOf` (B1).

```bash
pnpm --filter @midas/server exec vitest run app.test
pnpm --filter @midas/server exec vitest run   # full server suite
```
EXPECT: the liquidations route test now asserts `meta.sources` is an array with per-source
`stale`/`throttled`; full suite returns to **all-green at ≥ 368 + your new tests**.
- **If the full server suite drops below its baseline count or any file goes red →
  branch:** you changed a shape a sibling relied on (mock/demo drift is bug class H).
  Diagnose with `midas-debugging-playbook` (mock-vs-demo drift); do not "fix unrelated
  code to get green" — fix your regression or report drift (`midas-change-control`).
- **If you added a provider method but only implemented it on ccxt → typecheck or mock
  tests fail:** the `DataProvider` interface is implemented by mock/yahoo/demo too
  (`providers/types.ts`); implement it everywhere, honestly labeled.

---

## Phase 5 — Surface honestly in the web panel + hold demo fidelity (gate: web + demo build)

Render per-source staleness/throttle in `apps/web/src/modules/LiquidationsModule.tsx`
(it already has a source dot at :26-44 and an honesty banner at :47-59 — extend, don't
replace). **Web tests have no DOM** (`apps/web/vitest.config.ts:12`, `environment:'node'`)
— you cannot render the component; extract any new logic to `apps/web/src/lib/*.ts`
(alongside `summarizeLiquidations`, `lib/liquidations.ts`) and unit-test that, then verify
wiring by typecheck + build (`midas-validation-and-qa` owns this convention).

The static demo must mirror the server (fidelity contract, owned by
`midas-data-honesty-and-provenance`): update `apps/web/src/demo/engine.ts`
`liquidationsFeed` (:389-414) to emit the **same** new per-source meta shape, all
`synthetic:true`.

```bash
pnpm --filter @midas/web exec vitest run lib/liquidations   # focused: EXPECT 1 file green
pnpm -r typecheck
pnpm --filter @midas/web build:demo                         # the static demo must still build
```
- **If the demo build fails on a type/export only it uses → EXPECTED trap:** the demo
  replaces the whole server with a synthetic shim; the static-demo build is a distinct
  gate for exactly this. Fix the demo engine/shim to the new shape.
- **If the panel would show a green "live" dot while sources are stale/synthetic →
  STOP (Wrong Path #5):** the dot must reflect the honest per-source state.

---

## Phase 6 — Validate and promote (route through change control — do NOT reinvent it)

Do **not** restate the change lifecycle here — `midas-change-control` owns it. Run its
merge bar and follow its branch/PR rhythm. In brief, before the draft PR:

1. **The six gates + reviewer demo** — the full acceptance bar and how to run each is
   owned by `midas-validation-and-qa`; the exact CI step ORDER (build + bundle run
   BEFORE tests) is owned by `midas-build-and-env`. Run them all green.
2. **Adversarial pass** — have a skeptic try to refute M1-M5 on a fresh fixture
   (`midas-proof-and-analysis`). A green suite is necessary, not sufficient — an
   adversarial pass has historically caught medium bugs a green suite masked.
3. **Honesty checklist** — server route + web badge + demo shim agree; no synthetic-as-live;
   `unavailable` branch exists for a dead venue (`midas-data-honesty-and-provenance`).
4. **Single-concern draft PR** off `main`, with the failing→passing test, the derivation
   note, and the before/after numbers for M1-M5. **Humans own the merge, exchange config,
   and any deploy** — never merge, deploy, restart, or change `MIDAS_CCXT_*` as part of
   this change.

**Definition of done (measured, not eyeballed):** M3 + M4 present and tested (Option 1);
M1 + M2 present, tested, and surfaced as a *labeled lower bound* (Option 2); M5 still
green; six gates + reviewer demo green; one single-concern draft PR awaiting the maintainer.

---

## When NOT to use this skill

- **Domain questions** ("what unit is fundingRate", "which side is a liquidated long",
  "is this timestamp seconds or ms") → `crypto-market-reference`.
- **How provenance labeling works** (the unions, LIVE vs SIM, badge logic, demo↔server
  fidelity, the labeling checklist) → `midas-data-honesty-and-provenance`.
- **Whether/how a change may merge, the PR lifecycle, the execution-hold gate** →
  `midas-change-control`.
- **What tests to run / how to add a test / the six gates in detail** →
  `midas-validation-and-qa`; **recreating the env or the CI order** → `midas-build-and-env`.
- **A runtime symptom** (LIVE over mock, stale-overwrites-fresh, demo differs from
  server) → `midas-debugging-playbook`.
- **"Can we finish/revive X, why is Y dead"** (e.g. execution) → `midas-failure-archaeology`.
- **Broader "where can Midas advance the state of the art" positioning** →
  `midas-research-frontier`. This skill is *only* the executable liquidations/derivatives
  campaign.

---

## Provenance and maintenance (re-verify volatile facts before trusting them)

Date-stamped **2026-07-19**. Every row is a fact this runbook leans on; re-run the check
if the repo has moved. Do not treat drift-prone counts/defaults as eternal.

| Fact (as of 2026-07-19) | Re-verify (read-only) |
|---|---|
| Venue boards are multi-venue; `/api/liquidations` is single-provider | `grep -n "getVenueDerivatives\|getExchangeQuotes\|getDerivatives" apps/server/src/routes/market.ts` |
| ccxt liquidations read `this.exchange` only; `getVenueDerivatives` fans across `getCompareExchanges()` | `sed -n '326,421p' apps/server/src/providers/ccxt.ts` |
| Compare-set config `MIDAS_CCXT_COMPARE` (default owned by `midas-config-and-flags`) | `grep -n "MIDAS_CCXT_COMPARE" .env.example docker-compose.yml apps/server/src/providers/ccxt.ts` |
| `LiquidationsProvenance` is `{ source, available, synthetic?, note? }` — NO per-source/staleness/throttle | `sed -n '258,283p' packages/shared/src/market.ts` |
| No structured `staleness`/`throttled`/`sources` field exists yet in the contract | `grep -nE "staleness\|throttled\|perSource\|sources\[" packages/shared/src/market.ts` (expect: only `Quote.asOf` comment) |
| Server suite baseline: 45 files / 368 tests green | `pnpm --filter @midas/server exec vitest run` |
| Compute-helper test model: fundingDispersion 8, venueArb 5, oiConcentration 4 | `pnpm --filter @midas/server exec vitest run fundingDispersion` |
| Focused-test form (the `-- <name>` form does NOT filter) | `pnpm --filter @midas/server exec vitest run <pattern>` ; web: `pnpm --filter @midas/web exec vitest run <pattern>` |
| `/api/liquidations` route test asserts only source/available/asOf | `sed -n '135,155p' apps/server/src/app.test.ts` |
| Underreport 6-20x / Bybit $2.1B-vs-$333M / Binance stream removed 2021 (EXTERNAL claims) | `sed -n '106,131p' docs/research/2026-strategy-and-roadmap.md` |
| Web panel: 8s poll, source dot + honesty banner; web tests have no DOM | `sed -n '10,59p' apps/web/src/modules/LiquidationsModule.tsx` ; `cat apps/web/vitest.config.ts` |
| Demo `liquidationsFeed` must mirror the shape, `synthetic:true` | `sed -n '389,414p' apps/web/src/demo/engine.ts` |

Cross-referenced skills (use exact names; do not duplicate their owned facts):
`midas-change-control`, `midas-validation-and-qa`, `midas-build-and-env`,
`midas-config-and-flags`, `midas-run-and-operate`, `midas-architecture-contract`,
`crypto-market-reference`, `midas-data-honesty-and-provenance`, `midas-debugging-playbook`,
`midas-failure-archaeology`, `midas-proof-and-analysis`, `midas-research-frontier`.
