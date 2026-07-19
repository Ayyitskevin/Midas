---
name: midas-data-honesty-and-provenance
description: >-
  THE home for Midas invariant #1 (data honesty) and its #1 recurring bug class
  (synthetic data mislabeled as live). Load this BEFORE adding or changing ANY
  data surface — a new route, panel, badge, feed, webhook, or demo endpoint —
  and whenever you touch provenance labeling. Covers: the
  `provenance: live | synthetic | unavailable` unions (+ the paired `note`) and
  where they live in @midas/shared; the deliberate `live` (REST) vs `streamLive`
  (WebSocket) split and `providerStreamsLive`; the LIVE / SIM / RECONNECTING /
  IDLE / CONNECTING badge logic (`sourceView`, `streamStatusView`); the labeling
  CHECKLIST that keeps server route + web badge + demo shim in agreement; and the
  demo↔server fidelity contract (static demo in `apps/web/src/demo/{engine,shim}.ts`
  must mirror the real server). Triggers: "provenance", "live vs synthetic",
  "why does yahoo show SIM", "is this real data", "mislabeled / synthetic shown
  as live", "LIVE/SIM badge", "streamLive", "add a new market/account surface",
  "demo doesn't match the server", "webhook synthetic marker", wiring
  `sourceView`/`streamStatusView`/`demoBanner`/`providerStreamsLive`. NOT for the
  domain math behind a feed (see crypto-market-reference), the mislabel SYMPTOM
  triage (see midas-debugging-playbook), or how to write the tests (see
  midas-validation-and-qa).
---

# Midas data honesty & provenance

**The one-sentence invariant (Midas invariant #1):** every data surface honestly
labels whether the numbers are `live` (real upstream), `synthetic` (fabricated —
mock/demo), or `unavailable` (couldn't read it). **Synthetic is NEVER shown as
live. Missing data degrades to `unavailable` or a null field — it is NEVER a
fabricated value or a stale value relabeled live.** This skill is how that is
implemented and how to add a surface without lying.

If you break this, you ship the project's single most-repeated bug (dossier bug
class A: "honesty/provenance mislabeling"). Every honesty fix in this session
(#331/#332/#333) was closing an instance of it.

Terms used throughout: **provider** = the pluggable market-data backend
(`DataProvider`); **mock** = the default synthetic provider; **yahoo** = live REST
quotes, no live stream; **ccxt:\<id\>** = a real exchange (the only live-stream
source); **demo** = the serverless static build that runs entirely in the browser.

---

## 1. The provenance model — three states + a paired note

Every honest surface carries **two** fields together: a provenance enum **and** a
`note`. The note is the honesty caveat: `null` when live, a human string when not.

| State | Meaning | `note` |
|---|---|---|
| `live` | Real read from a real upstream (ccxt/yahoo/on-chain RPC). | `null` |
| `synthetic` | Fabricated data — the `mock` provider or the static demo. Useful offline, but NOT real. | a caveat string ("Synthetic demo … not a real account") |
| `unavailable` | The read could not be performed (no keys, RPC off, upstream down). | a reason string ("Configure read-only exchange API keys …") |

**Rule: never emit a provenance without its note, and never emit a value you
can't stand behind.** If you cannot get real data, return `unavailable` (or leave
the specific field `null`) — do not fall back to the last value and call it live,
and do not fabricate one.

### Where the labels are defined (`packages/shared/src/`)

Four are simple string-literal unions; the liquidations feed uses a **richer
interface** because its honesty story needs source + availability, not just a tri-state.

| Symbol | Kind | Location | Shape |
|---|---|---|---|
| `BalancesProvenance` | union | `account.ts:9` | `'live' \| 'synthetic' \| 'unavailable'` |
| `AccountProvenance` | union | `account.ts:50` | same |
| `OnChainProvenance` | union | `market.ts:286` | same |
| `SolanaProvenance` | union | `solana.ts:8` | same |
| `LiquidationsProvenance` | **interface** | `market.ts:258` | `{ source; available; synthetic?; note? }` |
| `LiquidationsMeta` | interface | `market.ts:274` | `extends LiquidationsProvenance` + `asOf` |

`LiquidationsProvenance` is the seed of the honest-derivatives work: liquidation
feeds under-report 6-20×, so the label carries **which source** and **whether it
even exposes a feed** — not just live/synthetic. The domain math and the
under-reporting theory belong to **crypto-market-reference**; this skill owns only
the labeling shape.

As of 2026-07-19, `provenance` appears in **58 files** across shared/server/web.
Re-count: `rg -l "provenance" packages/shared/src apps/server/src apps/web/src | wc -l`.

### Who sets which label (the source of the truth)

The provider that produces the data stamps the label; the route stamps
`unavailable` when it has no provider to call.

- **Real providers → `live`, `note: null`.** e.g. `solana/wallet.ts:96`,
  `providers/geckoterminal.ts:87`, `providers/dexscreener.ts:80`, ccxt account reads.
- **Mock provider / demo engine → `synthetic`, `note: <caveat>`.** e.g.
  `providers/mock/account.ts:35` ("Synthetic demo balances … not a real account"),
  `providers/mock/{solana,derivatives}.ts`, and every `xFor()` in `demo/engine.ts`
  (which pairs `provenance:'synthetic'` with the shared `NOTE` constant, `engine.ts:51`).
- **Route-level fallback → `unavailable`, `note: <why>`.** e.g.
  `routes/account.ts:22-51` returns an `unavailable` balances/orders/positions/fills
  snapshot when the caller has no per-user keys — never the operator's account;
  `routes/solana.ts` returns `unavailable` when the Solana RPC is off.

---

## 2. `live` vs `streamLive` — two liveness flags, deliberately separate

**This is the subtlety that trips everyone up.** There are two independent kinds
of liveness, and one provider (`yahoo`) has one but not the other.

- **`DataProvider.live`** (`providers/types.ts`) — **REST liveness**: does a
  request reach a real upstream? `mock.live=false`, `yahoo.live=true`,
  `ccxt.live=true`. Drives the **data-source** badge.
- **`HealthResponse.streamLive`** (`system.ts:57`) — **WebSocket liveness**: does
  the `/api/stream` socket deliver real upstream prints, or a synthetic
  random-walk? Drives the **socket** badge.

They diverge because the streaming layer only speaks CCXT Pro. The single source
of truth is `providerStreamsLive(provider)` = **`provider.name.startsWith('ccxt')`**
(`streaming.ts:52-54`). It is used in **two** places and must stay the only judge:

1. Stream source selection — `createStreamHub` builds a real ccxt websocket source
   only when `providerStreamsLive` is true, else the synthetic source (`streaming.ts:62`).
2. The `/api/health` `streamLive` flag — `routes/market.ts:103` sets
   `streamLive: providerStreamsLive(provider)`.

So a socket over yahoo/mock is a synthetic random-walk, and the UI must say so.

### Liveness truth table

| Provider | `live` (REST) | `streamLive` (WS) | source dot | socket dot (open) |
|---|---|---|---|---|
| `mock` (default*) | `false` | `false` | synthetic (amber) | **SIM** (amber) |
| `yahoo` | `true` | `false` | live (green) | **SIM** (amber) ← the trap |
| `ccxt:<id>` | `true` | `true` | live (green) | **LIVE** (green) |
| static `demo` | `false` | `false` | synthetic | IDLE (socket short-circuited) |

\* The default provider is synthetic (`mock`); the authoritative default value and
all env flags live in **midas-config-and-flags**. That default is exactly why an
un-configured instance must show SIM/synthetic, never LIVE.

**yahoo is the reason the two flags exist.** Before #332 the socket badge read
`open ⇒ LIVE`, so yahoo (and mock) showed "LIVE" over fabricated prints. Never
collapse `streamLive` back into `live`.

---

## 3. The badges — the two mapping functions you must reuse

Do not invent status strings in a panel. Two pure functions in `apps/web/src/lib`
own the entire mapping; the `StatusBar` is their only production consumer.

### `sourceView(provider, live)` — `lib/sourceStatus.ts:19-34` (the data-source dot)

| `live` | label | tone | dotClass |
|---|---|---|---|
| `true` | provider id | `live` | `text-term-up` (green) |
| `false` | provider id | `synthetic` | `text-term-amber` (amber) |

`demoBanner(provider, live)` (`sourceStatus.ts:48`) returns a first-run banner for
synthetic providers and **`null` for any live provider** — so the "you're on demo
data" banner never shows over real markets. Consumed by `components/DemoBanner.tsx`.

### `streamStatusView(status, subCount, streamLive = true)` — `lib/streamStatus.ts:25-59` (the socket dot)

| socket `status` | condition | label | tone | dotClass |
|---|---|---|---|---|
| `open` | `streamLive === true` | `LIVE` | `live` | `text-term-up` (green) |
| `open` | `streamLive === false` | `SIM` | `simulated` | `text-term-amber` (amber) |
| `connecting` | — | `CONNECTING` | `connecting` | `text-term-amber` |
| `closed` | `subCount > 0` | `RECONNECTING` | `reconnecting` | `text-term-down` (red) |
| `closed` | `subCount === 0` | `IDLE` | `idle` | `text-term-dim` |

Two design points you must preserve:

- **`streamLive` defaults to `true`.** A not-yet-loaded health poll must not flash
  "SIM" over a genuinely live ccxt feed. The StatusBar passes
  `health?.streamLive ?? true` (`StatusBar.tsx:51`).
- **`subCount` separates RECONNECTING from IDLE.** A dropped socket with active
  subscriptions is a real problem (red); with zero subs it's benign (dim).

---

## 4. THE CHECKLIST — add a data surface without lying

Run this for **every** new route/panel/feed. The failure mode is silent: one of
the three tiers (server, web, demo) disagrees and the terminal quietly lies. All
three must agree.

**A. Shared contract (`packages/shared/src`)**
- [ ] Does the response shape carry `provenance` + `note`? If it's a genuinely new
      shape, add a provenance union (reuse the `'live' | 'synthetic' | 'unavailable'`
      literal) or a richer interface like `LiquidationsProvenance` when you need
      source/availability. Put it in shared — both tiers import it.
- [ ] Units are a sibling honesty trap: candle `time` is **seconds** (`market.ts:17`).
      Unit/precision facts are owned by **crypto-market-reference** — check there.

**B. Server (`apps/server/src`)**
- [ ] Real provider path sets `provenance: 'live'`, `note: null`.
- [ ] Mock provider path (`providers/mock/*`) sets `provenance: 'synthetic'` + a
      caveat note. A missing mock path means the demo/offline mode shows nothing.
- [ ] The route returns `provenance: 'unavailable'` + a reason when it can't read
      (no keys / RPC off / upstream error) — **never** the operator's account, never
      a fabricated value. Pattern: `routes/account.ts:22-51`.
- [ ] Streaming? Route liveness through `providerStreamsLive` only. If you add a
      new streaming provider that IS live, that predicate is the one place to change.

**C. Web badge / panel (`apps/web/src`)**
- [ ] The panel renders the provenance honestly. A panel showing `synthetic` data
      must visibly not imply live (amber dot / "synthetic" suffix / demo styling).
- [ ] Reuse `sourceView` / `streamStatusView` — do not hand-roll status text.
- [ ] Streaming panel? Feed it `health.streamLive` (default `true`) so it shows
      SIM, not LIVE, on a non-ccxt feed.

**D. Demo shim + engine (`apps/web/src/demo`) — the most-forgotten tier**
- [ ] Add the endpoint to `handle()` in `demo/shim.ts` returning the SAME shape,
      defaults, validation, query-param handling, and status codes as the server.
- [ ] Add an `xFor()` in `demo/engine.ts` returning `provenance: 'synthetic'`,
      `note: NOTE`, `source: DEMO_SOURCE`.
- [ ] Mirror the server's error/hold contract: order writes → 503 `TradingSafetyHold`;
      unknown symbol → 404; auth/keys/sync → 501 `DemoUnavailable`; AI → 503 `NotConfigured`.

**E. Tests + change control**
- [ ] Behavioral fix ships a failing→passing test; add a demo regression test in
      `demo/demo.test.ts`. Web tests have **no DOM** — extract pure logic to
      `lib/*.ts` and unit-test that. Full testing doctrine: **midas-validation-and-qa**.
- [ ] One concern = one commit = one small draft PR: **midas-change-control**.

---

## 5. The demo↔server fidelity contract

The static demo (`demo/engine.ts` + `demo/shim.ts`) turns the whole terminal into
a serverless site by monkey-patching `fetch` to answer `/api/*` from an in-browser
engine. **It must mirror the real Fastify server's contract** — same shapes,
defaults, validation, query params, and error codes — because a user of the demo
sees exactly what a self-hoster sees.

**There is NO automated parity test.** Nothing diffs the demo against the server.
The contract is upheld by (a) discipline — this checklist — and (b) per-endpoint
regression tests in `demo/demo.test.ts`. Drift is invisible until someone compares
by hand (that is exactly how #331 was found). This is dossier bug class H
("mock-vs-demo contract drift"). When you change a server route's shape/defaults/
validation, **you must change the demo in the same PR** or you introduce drift.

What the demo already mirrors (don't regress these): the 503 execution hold on
order writes (`shim.ts`), `provenance: 'synthetic'` everywhere, and a health body
of `live:false, streamLive:false, demo:true` (`shim.ts:105-110`).

---

## 6. Worked example — #332, the SIM badge, end to end

The canonical "add an honesty flag across all tiers" change (commit `8a2622b`,
`git show 8a2622b`). **Symptom:** the socket badge showed "LIVE" on any open
socket, so mock and yahoo displayed LIVE over synthetic random-walk prints —
invariant #1 violated. **Fix, tier by tier (exactly the checklist above):**

1. **Shared** — added `streamLive: boolean` to `HealthResponse` (`system.ts:57`),
   documented as distinct from `live` (yahoo is `live:true, streamLive:false`).
2. **Server** — made `providerStreamsLive()` the single source of truth
   (`streaming.ts:52-54`) for BOTH the hub's source selection and the health flag;
   `/api/health` now sets `streamLive: providerStreamsLive(provider)`
   (`routes/market.ts:103`).
3. **Web** — `streamStatusView` gained the `streamLive` arg + a `'simulated'` tone
   → `open && !streamLive ⇒ SIM` (amber); `StatusBar` passes
   `health?.streamLive ?? true`.
4. **Demo** — `shim.ts` health reports `streamLive: false` (the demo never opens a
   live socket).
5. **Tests** — predicate (ccxt→true, mock/yahoo→false), badge SIM/LIVE/default,
   server health, demo health. Failing→passing, six gates green.

That is the shape of every honesty change: **shared type → server label →
web badge → demo mirror → tests**, one concern, one PR.

### Two shorter examples (same session)

- **#331 demo fidelity** (`bbe8dad`) — six ways the demo silently diverged from the
  server (screener PRICE sort fell back to volume order; `/api/fills` & `/api/news`
  ignored `?symbol=`; history echoed junk intervals instead of defaulting to 1d/6mo;
  order-book depth capped at 50 vs the server's 100; bare `Number()` turned empty
  params into empty responses; AI POST hit 501 not 503). No data was mislabeled —
  it was **contract drift** (bug class H). Fixed the engine/shim to match + added a
  regression test per divergence. This is why section 5 exists.
- **#333 out-of-band label** (`0c50ef2`) — honesty extends beyond the UI. On a
  non-live provider, webhook alert deliveries carried no marker, so a Discord/Slack
  consumer couldn't tell a mock-fired alert from a live signal. Fix: `buildWebhookPayload`
  gained a `synthetic` flag that prepends `⚠ SYNTHETIC — not live market data.`
  (`alerts/notify.ts:30,47-51`) and sets a structured `synthetic` field; `index.ts`
  passes `synthetic: !provider.live`. **Anywhere data leaves the process — UI,
  webhook, digest — it carries its provenance.**

---

## 7. The other in-code honesty enforcement points (know they exist)

Beyond the badges, these guards keep synthetic/stale data from leaking as live.
Do not weaken them:

- **Alert engine reads account metrics only when `provenance === 'live'`**
  (`alerts/engine.ts:65,83`) — an unreadable/synthetic account leaves the symbol
  unread so a rule stays armed instead of firing on fake numbers. It also refuses
  account reads entirely once any alert owner is non-`@local` (cross-user leak
  guard, `engine.ts:57`).
- **Account routes** return an honest `unavailable` snapshot rather than the
  operator's env-keyed account (`routes/account.ts:22-51`).
- **Webhook deliveries** prefixed `⚠ SYNTHETIC` on a non-live provider (§6, #333).

Cross-references: the **domain math** behind any feed → crypto-market-reference;
the mislabel **SYMPTOM triage** ("a panel shows LIVE but numbers look fake") →
midas-debugging-playbook; this invariant's place among all six → midas-architecture-contract.

---

## When NOT to use this skill

| You need… | Use instead |
|---|---|
| The math/theory of a feed (funding, OI, liquidation under-reporting, basis) | **crypto-market-reference** |
| To triage a live mislabel symptom (what's wrong, discriminating experiment) | **midas-debugging-playbook** |
| The full list of invariants / DataProvider seam / how to add a panel | **midas-architecture-contract** |
| How to write/run the tests, the six gates, the web-no-DOM convention | **midas-validation-and-qa** |
| The env var that picks the provider + all defaults | **midas-config-and-flags** |
| To get an honesty change reviewed/merged (PR rules, promotion) | **midas-change-control** |

This skill owns the **mechanics** (unions, live/streamLive/SIM, badges, the
checklist, the demo contract). It does not own domain math, symptom triage,
testing, config values, or review process — cross-reference those owners.

---

## Provenance and maintenance

Verified against the repo at commit `6b0d5ed` (HEAD, PR #334 merged) on
**2026-07-19**. Re-verify volatile facts before relying on them:

| Fact (date-stamped 2026-07-19) | Re-verification command |
|---|---|
| 4 provenance unions + `LiquidationsProvenance` interface, at the listed file:lines | `rg -n "Provenance" packages/shared/src` |
| `provenance` appears in 58 files | `rg -l "provenance" packages/shared/src apps/server/src apps/web/src \| wc -l` |
| `providerStreamsLive` = `name.startsWith('ccxt')`, single source of truth | `rg -n "providerStreamsLive" apps/server/src` |
| `streamLive` flows shared→health→web→demo | `rg -n "streamLive" packages/shared/src apps/server/src apps/web/src` |
| `sourceView` mapping (live→green / synthetic→amber) | `sed -n '19,54p' apps/web/src/lib/sourceStatus.ts` |
| `streamStatusView` LIVE/SIM/CONNECTING/RECONNECTING/IDLE | `sed -n '25,59p' apps/web/src/lib/streamStatus.ts` |
| Provider `live` values (mock=false, yahoo/ccxt=true) | `rg -n "live = " apps/server/src/providers/{mock.ts,yahoo.ts,ccxt.ts}` |
| The three worked-example PRs | `git show 8a2622b` (#332), `git show bbe8dad` (#331), `git show 0c50ef2` (#333) |
| No `pnpm lint` gate exists (don't invent it) | `rg -n '"lint"' package.json apps/*/package.json packages/*/package.json` |

If a badge label, a provenance union, or `providerStreamsLive` changed, update the
truth tables in §2-§3 and re-confirm the demo (`demo/shim.ts` health body) still
reports `live:false, streamLive:false, demo:true`.
