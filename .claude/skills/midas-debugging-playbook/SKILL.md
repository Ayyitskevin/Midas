---
name: midas-debugging-playbook
description: >-
  Symptom→triage for Midas's live failure modes. Load this WHEN something is
  wrong at runtime and you must classify it fast: a badge shows LIVE over mock
  data or a new panel ships without a provenance label (honesty); a delete/edit
  gets silently reverted or stale data overwrites fresh (race/TOCTOU); memory or
  stream-source slots climb as symbols are subscribed/dropped (teardown leak); a
  Map keyed by user input grows without bound (unbounded cache); an error
  response or `note` leaks a signed URL / API key / hostname (error disclosure);
  an authed-but-unkeyed caller sees the operator's account (multi-tenant); a time
  axis lands in 1970 or a sub-cent price shows 0.00 (units/precision); the static
  demo returns wrong/empty data a real server wouldn't (mock-vs-demo drift); or a
  panel opens blank / "Unknown module" / a command opens the wrong panel
  (registration triad out of sync). Triggers: "why is this intermittently
  failing", "memory leak", "shows LIVE but it's mock", "which bug class is this",
  "silently reverted", "stale data", "0.00 price", "1970 timestamp", "demo
  differs from server". For the CLOSED trading retraction see midas-failure-
  archaeology; for provenance MECHANICS see midas-data-honesty-and-provenance.
---

# Midas debugging playbook

You are debugging a **pre-release self-hosted crypto market-research terminal**
(pnpm monorepo: `packages/shared` contract, `apps/server` Fastify, `apps/web`
React/Vite). This skill triages the **8 recurring bug classes** that keep
reappearing as new panels/providers are added, plus the **registration-triad
out-of-sync** symptom. Every class below is grounded in a real fix commit from
this repo — cited by hash and, where it was a merged PR this session, by number.

Use it to answer one question fast: **which class am I in?** Each card gives you
symptom → likely files → a *discriminating experiment* (one copy-paste check
that rules the class in or out) → the fix pattern that closed it last time.

## How to work a bug here (the discipline)

1. **Reproduce it, then classify** with the triage table below.
2. **Run the discriminating experiment** for the top candidate. It tells you
   which class you are in — do not guess from the symptom alone (several classes
   share a symptom: a "wrong number" is class A, G, or H).
3. **Write the failing test FIRST**, in the tier that owns the bug. Every
   behavioral fix in this repo ships a **failing→passing regression test** —
   this is a hard merge bar (see `midas-change-control`). The green suite has
   *masked* real bugs here (a race in `4aca668`; a seconds/ms bug in `5d3af8e`
   whose old test used `Date.UTC` = ms), so a passing suite is not proof.
4. **Fix, confirm the new test flips**, keep it single-concern.
5. **One concern = one commit = one small draft PR.** Do not bundle two classes.
   Promotion/behavior changes route through `midas-change-control`.

**Adversarial verification catches what the six gates miss.** The stream-teardown
fix `f3e2eee` (PR #330) exists *only* because an adversarial review of the prior
fix `811626f` found it released the hub slot but not the socket's ledger + IP
quota. When you fix one resource, ask what *else* the same path acquired. See
`midas-proof-and-analysis` for the adversarial-verification recipe.

## The 60-second triage table

| You observe… | Likely class | Card |
|---|---|---|
| A badge/label/delivery says LIVE (or omits a synthetic marker) while the provider is `mock`/`yahoo`; a new surface has no `provenance` | **A** Honesty mislabel | [A](#a-honesty--provenance-mislabeling) |
| A create/delete/edit is silently reverted; stale data overwrites fresh; only happens under overlapping async / concurrency | **B** Race / TOCTOU | [B](#b-races--toctou) |
| Stream-source slots, memory, or connections climb as symbols are subscribed then dropped; a connection can't re-subscribe a symbol | **C** Stream teardown leak | [C](#c-stream--socket-teardown-leaks) |
| A Map/array keyed by user-controlled input grows without bound; memory climbs under a junk-key spray | **D** Unbounded cache | [D](#d-unbounded-per-tenant-caches--stores) |
| An error response, an `unavailable` `note`, or a log carries a signed URL / `signature=` / API key / hostname / stack | **E** Error disclosure | [E](#e-error-string-disclosure) |
| With auth ON, an authed-but-unkeyed caller sees the operator's account; a cross-user financial path; an alert armed but never evaluated | **F** Multi-tenant isolation | [F](#f-multi-tenant-isolation) |
| A time axis lands in 1970; buckets collapse; a sub-cent price shows `0.00`/`0.0000`; two channels disagree on one number; a notional off by a scale factor | **G** Units / precision | [G](#g-units--precision--normalization) |
| The static demo returns wrong/empty data a real server wouldn't; `build:demo` fails while the normal build is green | **H** Mock-vs-demo drift | [H](#h-mock-vs-demo-contract-drift) |
| A panel opens blank / "Unknown module"; a command opens the WRONG panel; `registry.test.ts` fails in CI | **Triad** out of sync | [Triad](#registration-triad-out-of-sync) |

Terms: **provider** = the `DataProvider` behind the server (`mock` default,
`live=false`; `yahoo` live REST, no live stream; `ccxt:*` the only live stream
source). **provenance** = a `'live' | 'synthetic' | 'unavailable'` label every
data surface must carry. **`live`** (REST liveness) and **`streamLive`** (WS
liveness) are deliberately SEPARATE fields on `/api/health`. **TOCTOU** =
time-of-check-to-time-of-use (a value read, then acted on after it may have
changed). **triad** = the three files every panel must be registered in.

---

## A. Honesty / provenance mislabeling

**The #1 recurring class.** The product's core promise (`live`/`synthetic`/
`unavailable` labels) is also its most-repeated bug: a new data path ships a
synthetic feed labeled `live`, caught after the fact.

- **Story:** PR **#332** (`8a2622b`) — the StatusBar connection badge showed
  **LIVE** on *any* open socket, but the WS falls back to a synthetic random-walk
  for every non-ccxt provider, so `mock` (and `yahoo`, live REST but no live
  stream) displayed LIVE over fabricated prints. Fix added `streamLive` to
  `/api/health`, distinct from `live`. PR **#333** (`0c50ef2`) — webhook alert
  deliveries fired on synthetic `mock` data with no marker, so a Discord/Slack
  consumer couldn't tell a mock-fired alert from a live signal. Prior: `101cc7a`,
  `e1bd937`, `fd124a2`.
- **Symptom:** a surface asserts liveness it doesn't have, or a new panel/feed/
  delivery has no provenance at all.
- **Likely files:** `apps/web/src/lib/streamStatus.ts` (SIM mapping :28-39),
  `lib/sourceStatus.ts`, `components/StatusBar.tsx`; server
  `streaming.ts:52` (`providerStreamsLive` — the single source of truth),
  `routes/market.ts:99-106` (`/api/health` sets `live`+`streamLive`);
  `alerts/notify.ts`; the four provenance unions in `packages/shared`.
- **Discriminating experiment:** ask the server what it *is*, then check what the
  surface *claims*.
  ```bash
  # start a mock server (default provider) in another shell, then:
  curl -s localhost:4000/api/health | grep -oE '"(live|streamLive|demo)":[a-z]+'
  # mock ⇒ live:false, streamLive:false. If any badge/delivery shows LIVE ⇒ class A.
  grep -nE "provenance|synthetic|streamLive|note" <the-new-surface-file>
  # a new data surface with NO provenance/synthetic marker IS the trap.
  ```
- **Fix pattern:** never derive "live" from "a socket is open." Route liveness
  through `providerStreamsLive()` (one predicate feeds both the hub's source
  choice and the health flag). Every new surface carries `provenance` +
  `note`; a synthetic feed is labeled `synthetic`/SIM, a failed read degrades to
  `unavailable` — never a fabricated or stale-relabeled value.
- **Owned elsewhere:** the provenance *mechanics* (the unions, live vs streamLive
  vs SIM, the labeling checklist for a new surface) live in
  **`midas-data-honesty-and-provenance`**. This card is the SYMPTOM only.

## B. Races / TOCTOU

**Symptom:** correct-*looking* code intermittently loses writes or shows stale
data; a deleted thing resurrects; only reproduces when two operations overlap in
time. The green suite misses it.

- **Story:** PR **#325** (`4aca668`) — `AlertRepo.commit()` replaced the live
  alert list *wholesale* with `next`, a snapshot taken BEFORE the evaluation
  pass's awaited provider reads. Any create/delete/rearm that landed during those
  reads was silently reverted (a deleted alert resurrected; a fresh one dropped).
  PR **#328** (`be2a44e`) — web async-response races: `useFetch` (~227 call
  sites) let a slow earlier poll resolve *after* a newer one and overwrite fresh
  data; `useServerSync` marked a snapshot synced BEFORE the push resolved, so a
  failed push silently reverted the edit on next login. Prior: `7ba164f`
  (daily-cap TOCTOU reserve/release), `ca80d58` (signup race). Two of the five
  retired-trading failures were races too.
- **Likely files:** server `alerts/repo.ts` (`commit` merge-by-id :148-165); any
  read-`await`-then-write. Web `lib/hooks.ts` (`useFetch`), `lib/useServerSync.ts`,
  `lib/latestGate.ts` (the shared "latest wins" gate).
- **Discriminating experiment:** *does the bug need two operations overlapping?*
  Serialize them (or await one fully before the other) — **if it vanishes when
  serialized, it is a race.** Two specific tells:
  - Read-modify-write over an `await`: does the write use the **pre-`await`
    snapshot**? Grep the commit/write for a variable captured before the
    `await`. `apps/server/src/alerts/repo.ts:157` (`new Map(next…)`) is the
    canonical merge-by-id fix — compare your path to it.
  - Web out-of-order: is there a **latest-gate**? `grep -n "createLatestGate\|isLatest" <hook>` — its absence around overlapping async is the trap.
- **Fix pattern:** reserve-before-`await` (not check-then-act); **merge by id**,
  never replace-wholesale, so writes that landed during awaited reads survive; a
  monotonic **latest-wins gate** (`createLatestGate()`, `lib/latestGate.ts`) to
  discard a stale async result; advance a sync baseline **only on push success**.
  The regression test must interleave the operations (see `repoCommit.test.ts`).

## C. Stream / socket teardown leaks

**Symptom:** resource counts climb as symbols are subscribed then dropped —
global stream-source slots, memory, or exchange connections; or a connection
becomes unable to re-subscribe a symbol; or per-IP quota erodes for dead streams.

- **Story:** PR **#330** — two commits. `811626f`: `stop()` only flipped
  `running=false`, never told ccxt to `unWatch`, so the exchange-side
  subscription and its per-symbol cache lived for the process lifetime; and a
  `BadSymbol` (unlisted market) killed the watch loop but the hub kept the
  `SourceEntry`, holding one of the 500 global source slots **forever** while
  later subscribers silently joined the dead source. `f3e2eee` (the adversarial
  follow-up): the fatal teardown freed the hub slot but **not** the WS route's
  per-socket `held` ledger or per-IP quota, so the socket could never rebuild
  that stream and its quota stayed charged for a corpse. Prior: `8765b34`
  (per-client fairness + stop retrying dead symbols), `c89d8c1` (cap WS frame
  size — unauth OOM).
- **Likely files:** `apps/server/src/streaming.ts` — `onFatal`/`onDrop`
  (:78-92), the `held` ledger + IP-quota release (:362-406),
  `MAX_STREAM_SOURCES=500` (:43); `apps/server/src/ccxt-stream.ts` (`unWatch*`
  feature-detected, never `close()`, :44-64).
- **Discriminating experiment:** *does teardown return every resource to
  baseline?* Subscribe then unsubscribe N distinct symbols and watch the source
  count; make one symbol a permanently-dead (unlisted) market:
  ```bash
  cd /home/user/Midas && pnpm --filter @midas/server test src/streaming.test.ts src/ccxt-stream.test.ts
  ```
  These assert: `unWatch` on stop; `onFatal` fires once on `BadSymbol`; the hub
  error-frames subscribers, runs each `onDrop`, drops the entry, and a fresh
  subscribe **rebuilds**. If your path leaks, the analogous assertion is missing.
  Checklist — teardown must release **all three**: (1) the exchange `unWatch`,
  (2) the hub source slot, (3) the socket's `held` slot **and** its IP quota.
- **Fix pattern:** teardown is explicit and releases *everything the path
  acquired*. `unWatch` the exact `(channel, symbol)` (feature-detected so old
  ccxt/test fakes are safe; never `close()` — one instance multiplexes all
  symbols); drop dead sources via `onFatal`; run each subscriber's `onDrop` to
  release its held slot + IP quota; defer the exchange call (`.then()`) so
  `stop()` can never synchronously throw.

## D. Unbounded per-tenant caches / stores

**Symptom:** a `Map`/array keyed by user-controlled input has no size bound;
memory grows under load or a junk-key spray; a per-tenant collection is capped
globally instead of per-owner (one noisy tenant starves the rest).

- **Story:** PR **#329** (`0a48481`) — `createTtlCache` (behind the fan-out
  boards: funding-dispersion / venue-arb / oi-concentration) **never evicted**:
  expired entries lingered and a key requested once stayed forever, so a
  junk-quote spray grew the `Map` without limit — a memory DoS on public routes.
  Fix: drop expired on access, cap distinct keys evicting oldest-first past
  **500**, and add `normalizeQuote` at the route edge so key cardinality is
  bounded at the source. Prior: `6b55d80` (bound the alert trigger log **per
  owner**, not globally), `cb0bd8b` (isolate+bound the alert store), `b150a47`
  (cap credential length — unauth CPU/disk DoS).
- **Likely files:** `apps/server/src/ttlCache.ts` (`prune` :66-82,
  `DEFAULT_MAX_ENTRIES=500` :22), `routes/shared.ts` (`normalizeQuote`),
  `alerts/repo.ts` (`MAX_ALERTS_PER_OWNER`/`MAX_TRIGGERS_PER_OWNER`).
- **Discriminating experiment:** find the collection behind the route and ask
  three questions — **is there a max-size bound? an eviction path? key-
  cardinality bounded at the edge?** Missing any one ⇒ class D.
  ```bash
  cd /home/user/Midas && pnpm --filter @midas/server test src/ttlCache.test.ts
  # asserts TTL expiry, single-flight de-dup, expired-eviction, AND the max-entries bound.
  grep -nE "new Map|\.set\(|push\(" <the-collection-file>   # then look for a matching cap/evict
  ```
- **Fix pattern:** bound distinct keys (evict oldest-first past a cap — a `Map`
  preserves insertion order), drop expired entries on access, and normalize/
  validate the key at the route edge (`/^[A-Z0-9]{1,10}$/`, junk → default) so
  cardinality is bounded at the source. Bound **per owner**, not globally.

## E. Error-string disclosure

**Symptom:** an API error, an `unavailable` snapshot `note`, or a log line
carries raw upstream detail — a signed request URL with `signature=` /
`X-MBX-APIKEY`, the raw response body, an internal hostname, or a stack.

- **Story:** `a545d84` — a ccxt error message can carry the signed request URL
  (HMAC signature + API key). `describe()` interpolated that raw message into the
  `ProviderError` on market reads **and** into the `note` of the balances/orders/
  positions/fills `unavailable` snapshots — both reach the client. The *write*
  path was already sanitized (`toSafeWriteError`); the *read* path was not.
  `16f973d` — the global error handler echoed `error.message` verbatim on
  unexpected 5xx (leaking stack + the same ccxt URL); now only `ProviderError`
  (already safe) and `<500` send their own message.
- **Likely files:** `apps/server/src/providers/ccxt/helpers.ts`
  (`safeErrorLabel` :23 — returns the error **class name** only),
  `providers/ccxt.ts` (`describe` :954; throw sites :217,280,297,751; comment at
  :750 "strip it"), `app.ts` error handler (:258-278).
- **Discriminating experiment:** trigger a provider error (bad symbol / bad key)
  and read the response body + `note`. Does it contain anything beyond a bounded
  class-name label (`AuthenticationError`, `NetworkError`)?
  ```bash
  cd /home/user/Midas && pnpm --filter @midas/server test src/providers/ccxt.test.ts
  # and: grep for a NEW throw that bypasses the sanitizer —
  grep -nE "throw new (Provider)?Error|reply\.(send|code)" apps/server/src/providers/ccxt.ts
  ```
  A throw site in `ccxt.ts` that does **not** route through `describe()`/
  `safeErrorLabel` is the reopened leak (`ccxt.ts` ~964 loc is the sanitization
  chokepoint — a new throw is the recurring escape).
- **Fix pattern:** every client-facing error path goes through
  `safeErrorLabel`/`describe` (class name only; preserves our own already-safe
  `ProviderError`). Unexpected 5xx → generic `"Internal Server Error"`, log the
  real one server-side.

## F. Multi-tenant isolation

**Symptom:** with auth ON, an authed-but-**unkeyed** caller sees the operator's
env account; or a financial reading crosses users; or an alert is persisted
`armed` while nothing actually evaluates it.

- **Story:** `5fe721c` — isolate unkeyed tenant account reads (an authed caller
  with no stored key must **not** fall back to the operator's env creds).
  `e6363c3` — under multi-user auth no per-user loop evaluates equity/upnl
  alerts, yet the API still persisted them `armed`: a dead alert shown as live
  monitoring. The global alert loop refuses account reads once **any** owner is
  non-`@local` (cross-user leak prevention).
- **Likely files:** `apps/server/src/keys/pool.ts` (`accountFor`/`userFor`
  :43-72), `alerts/engine.ts` (`accountReadsSafe` :57, live-only reads :65,83),
  `alerts/routes.ts` (reject equity/upnl for an authed owner :32-37).
- **Discriminating experiment:** with auth on and **no** stored key, hit an
  account route as an authed user. You must get an honest `unavailable`/null
  snapshot — **never** the operator's data. For alerts: is the account-metric
  alert actually evaluated under multi-user, or dead-but-armed?
  ```bash
  cd /home/user/Midas && pnpm --filter @midas/server test src/keys/keys.test.ts src/alerts.test.ts
  ```
- **Fix pattern:** `pool.accountFor` returns the caller's **own** provider or
  `null`, never base; `pool.userFor` never falls back; the alert loop reads
  account metrics only when every owner is `@local`; reject *creating* account-
  metric alerts for an authenticated owner (clear 400). The per-user-key
  isolation invariant is listed in `midas-architecture-contract`.

## G. Units / precision / normalization

**Symptom:** a time axis lands in 1970 and buckets collapse; a sub-cent price
shows `0.00`/`0.0000`; two channels disagree on the same number; a notional is
off by a scale factor. **Beware: a test using the already-normalized form masks
this.**

- **Story:** `5d3af8e` — `computeSeasonality` passed `Candle.time` (a Unix
  timestamp in **seconds**, per the `@midas/shared` contract) straight to
  `new Date()`, which reads **milliseconds** — so ~`1.75e9` landed in Jan 1970
  and a 3-month hourly history collapsed into 2–3 adjacent 1970 buckets. The
  existing tests used `Date.UTC()` (ms), which **masked** the bug. `ce8a818` /
  `79d4942` — the webhook formatter hard-coded `toFixed(2)`, so a sub-cent token
  (BONK/PEPE) alert rendered `"0.00"` while the browser toast for the *same*
  trigger correctly showed `"0.00002500"`; fix lifted `priceDecimals` (magnitude-
  scaled) into `@midas/shared` so both formatters agree. (Execution-hold reason 4
  was a USD-notional normalization failure — see `midas-failure-archaeology`.)
- **Likely files:** `packages/shared/src/market.ts` (`Candle.time` in **seconds**,
  ~:17), `apps/web/src/lib/seasonality.ts`, `packages/shared/src/alerts.ts`
  (`priceDecimals` :199, `ACCOUNT_SYMBOL` :16), `alerts/notify.ts`.
- **Discriminating experiment:** log the raw magnitude. A `Candle.time` ~`1.7e9`
  is **seconds** (correct); if code feeds it to `new Date()` (expects ms) you get
  1970 ⇒ class G. For precision: is the value `< 0.01` while the formatter uses a
  fixed 2 decimals? And **check the test's inputs** — if it constructs times with
  `Date.UTC(...)` (ms) or prices ≥ 1, it will pass while prod breaks; the
  regression test must feed *real* seconds / sub-cent values.
- **Fix pattern:** normalize at the boundary (seconds→ms, tolerating an
  already-ms value); a **single shared precision policy** (`priceDecimals` in
  shared — pure `Math`, respecting the dependency-free invariant) consumed by
  *both* formatters. Domain-math formulas live in `crypto-market-reference`.

## H. Mock-vs-demo contract drift

**"Two synthetic worlds."** Synthetic data is generated **twice** — the server's
`mock` provider (`providers/mock/*`) and the in-browser static demo
(`demo/engine.ts` + `demo/shim.ts`) — and they drift.

- **Story:** PR **#331** (`bbe8dad`) — the demo diverged from the Fastify server
  in several endpoints, silently returning wrong/empty data: Screener PRICE sort
  returned volume order; `/api/fills` and `/api/news` ignored `?symbol=`; History
  defaulted 1h/1mo and echoed junk interval/range instead of the server's 1d/6mo
  + `isInterval`/`isRange` validation; order-book depth capped at 50 vs the
  server's 100; bare `Number()` on a query param produced empty responses; the AI
  POST fell to a generic 501 instead of 503. Prior: `546ccf3` (derive the SOL
  swap basis from the shared asset price).
- **Likely files:** `apps/web/src/demo/engine.ts`, `demo/shim.ts`;
  `apps/server/src/providers/mock/*`; the shared `compute*` helpers both consume.
- **Discriminating experiment:** run the **same** request against the real mock
  server and the static demo; compare. And remember `build:demo` is a **separate
  gate** — a green normal build can still fail it (a type/export only the demo
  uses):
  ```bash
  cd /home/user/Midas && pnpm --filter @midas/web build:demo   # separate from `build`
  pnpm --filter @midas/web test src/demo/demo.test.ts          # the drift regressions
  ```
  If the demo's answer differs from the server's for the same input ⇒ class H.
- **Fix pattern:** mirror the server's route semantics *exactly* in the shim —
  validate params (`isInterval`/`isRange`), honor `?symbol=`, same caps/defaults,
  same status codes (including the 503 `TradingSafetyHold` on `/api/orders`);
  reuse the **shared** `compute*` helpers so honesty rules match; add a demo
  regression test. The demo↔server fidelity contract is detailed in
  `midas-data-honesty-and-provenance`.

## Registration triad out of sync

The **single most-touched seam** in the repo (~220 changes each). Every one of
the ~231 panels must be registered in **three files in lockstep**:
`commands/registry.ts` (the command) + `modules/registry.tsx`
(`MODULE_COMPONENTS` lazy import) + `modules/meta.ts` (`ModuleCode` union +
`MODULE_META`). This is **Invariant 4** and the #1 structural trap when adding a
panel.

- **Symptom:** a panel opens blank or "Unknown module" (`Panel.tsx` renders that
  when a code is missing from `registry.tsx`); a command opens the **wrong**
  panel (a later duplicate alias quietly stole the token — typing `VAR` once
  opened VIDYA instead of VaR); or CI fails `registry.test.ts`.
- **Likely files:** `apps/web/src/commands/registry.ts` (+ per-theme groups),
  `modules/registry.tsx`, `modules/meta.ts`.
- **Discriminating experiment:**
  ```bash
  cd /home/user/Midas && pnpm --filter @midas/web test src/commands/registry.test.ts
  # failure names the missing leg / duplicate token / thin (<20 char) description.
  # Or find the out-of-sync leg — a code present in fewer than all three files:
  grep -rn "'<YOURCODE>'\|\"<YOURCODE>\"" apps/web/src/commands/registry.ts apps/web/src/modules/registry.tsx apps/web/src/modules/meta.ts
  ```
- **Fix pattern:** add the panel to **all three** files together. This card is
  the SYMPTOM; the full **add-a-panel runbook** lives in
  **`midas-architecture-contract`** — go there to add one correctly.

---

## When NOT to use this skill

- **A CLOSED / settled battle** (the live-trading retraction `0b83c4f`,
  `trading.ts` dead scaffolding, the giant-file splits, "why is the security
  review incomplete") → **`midas-failure-archaeology`**. This skill is for bugs
  that are **still live traps**; that one is the chronicle of fights already won.
- **The provenance *mechanics*** (the unions, `live` vs `streamLive` vs `SIM`,
  the labeling checklist for a new surface, the demo↔server fidelity contract) →
  **`midas-data-honesty-and-provenance`**. Card A here is the symptom, not the
  mechanism.
- **Adding a panel correctly** (the triad runbook, the DataProvider seam) →
  **`midas-architecture-contract`**.
- **How to MEASURE** (bundle check from root, focused vitest, quota/stream
  introspection scripts) → **`midas-diagnostics-and-tooling`**; **what counts as
  evidence / the six gates / how to add a test** → **`midas-validation-and-qa`**.
- **Classifying/gating/promoting the fix** (single-concern PR, the failing→
  passing bar, the execution-hold gate) → **`midas-change-control`**.
- **Domain math** (funding/OI/liquidation formulas behind a "wrong number") →
  **`crypto-market-reference`**.

## Provenance and maintenance (verify before trusting; dated 2026-07-19)

Volatile facts below drift as the repo changes — re-verify with the paired
command. Evidence priority: **CI > code > docs**. "Code wins over docs."

| Fact (as of 2026-07-19) | Re-verify (read-only) |
|---|---|
| PR→commit map: #325→`4aca668`, #328→`be2a44e`, #329→`0a48481`, #330→`f3e2eee`(+`811626f`), #331→`bbe8dad`, #332→`8a2622b`, #333→`0c50ef2` | `git log --oneline --merges -15` then `git rev-parse <merge>^2` |
| Class E/F/G commits: `a545d84`,`16f973d` / `5fe721c`,`e6363c3` / `5d3af8e`,`ce8a818`,`79d4942` | `git show --stat <hash>` |
| `providerStreamsLive` at `streaming.ts:52`; `/api/health` sets `live`+`streamLive` at `routes/market.ts:99-106` | `grep -nE "providerStreamsLive\|streamLive" apps/server/src/streaming.ts apps/server/src/routes/market.ts` |
| SIM badge mapping `streamStatus.ts:28-39` | `grep -n "SIM\|streamLive" apps/web/src/lib/streamStatus.ts` |
| `AlertRepo.commit` merge-by-id `alerts/repo.ts:148-165`; `createLatestGate` in `lib/latestGate.ts` | `grep -n "commit\|Merge by id" apps/server/src/alerts/repo.ts` |
| Stream teardown `streaming.ts` onFatal :78-92, held/quota release :362-406; `MAX_STREAM_SOURCES=500` :43 | `grep -nE "onFatal\|onDrop\|MAX_STREAM_SOURCES\|ipQuota" apps/server/src/streaming.ts` |
| `ttlCache.ts` `prune` :66-82, `DEFAULT_MAX_ENTRIES=500` :22 | `grep -nE "prune\|MAX_ENTRIES" apps/server/src/ttlCache.ts` |
| `safeErrorLabel` (class name only) `providers/ccxt/helpers.ts:23`; `describe` `ccxt.ts:954` | `grep -rn "safeErrorLabel" apps/server/src/providers/ccxt/` |
| Isolation: `keys/pool.ts:43-72`, `alerts/engine.ts:57`, `alerts/routes.ts:32-37` | `grep -nE "accountFor\|accountReadsSafe\|@local" apps/server/src/keys/pool.ts apps/server/src/alerts/engine.ts` |
| `Candle.time` in **seconds**; `priceDecimals` `shared/src/alerts.ts:199` | `grep -nE "priceDecimals\|time" packages/shared/src/market.ts packages/shared/src/alerts.ts` |
| Triad guard `apps/web/src/commands/registry.test.ts`; ~231 panels | `pnpm --filter @midas/web test src/commands/registry.test.ts` |
| Focused-test form: canonical is `pnpm --filter @midas/<pkg> exec vitest run <pattern>` (owned by `midas-validation-and-qa`). The bare `test <path>` used in the cards above filters too, but `test -- <name>` does NOT — verified 2026-07-19. | `grep -n '"test"' apps/server/package.json apps/web/package.json` |
| `build:demo` is a SEPARATE gate from `build` | `grep -n "build:demo" apps/web/package.json` |

Re-verify the whole recent-fix landscape: `git log --oneline -60`. If a
`file:line` has moved, trust the `grep` and update the anchor — the commit hash
and the *pattern* are the durable evidence, the line number is not.
