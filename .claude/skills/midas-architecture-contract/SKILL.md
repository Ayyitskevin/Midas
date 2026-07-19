---
name: midas-architecture-contract
description: >-
  Load when you need the load-bearing design of Midas and WHY it is shaped this way:
  the three-tier pnpm monorepo with one dependency direction, the `@midas/shared`
  data contract consumed as raw TypeScript by both server and web, the pluggable
  `DataProvider` seam, and the SIX invariants that must never break (data honesty,
  non-custody, Base-58 case-sensitivity, registration-triad-in-sync, perf budget
  155/700 KB gzip, shared package dependency-free). Also load for the safe way to
  ADD A PANEL/MODULE (the registration triad: commands/registry.ts +
  modules/registry.tsx + modules/meta.ts in lockstep, enforced by a CI parity test).
  Triggers: "how is Midas structured", "add a panel/module", "add a command",
  "what are the invariants", "why is shared dependency-free", "DataProvider",
  "monorepo layout", "can I add a dependency to shared", "Unknown module", "what
  must I not break", "architecture", "add an indicator board".
---

# Midas — Architecture Contract

The load-bearing design decisions, the invariants that must hold, the known-weak
points, and the runbook for the most dangerous routine change: adding a panel.

Read this before you touch structure. If a task seems to require breaking an
invariant below, **the task is wrong — stop and report** (per `midas-change-control`).

**Term glossary (defined once):** *panel / module* = one React component that
renders a tile in the terminal grid, keyed by a short **`ModuleCode`** (e.g. `GP`,
`FUND`). *Command* = a Bloomberg-style mnemonic the user types to open a module.
*Provider* = a `DataProvider` implementation that turns a request into typed data.
*Provenance* = the honesty label `live | synthetic | unavailable` on every data
surface. *The triad* = the three files a panel must be registered in.

---

## 1. Three tiers, one dependency direction

Midas is a **pnpm monorepo** (`pnpm-workspace.yaml`: `apps/*`, `packages/*`) with
three workspaces and exactly one rule between them — **`@midas/shared` is imported
by both apps and imports nothing back**:

```
packages/shared   @midas/shared — the data contract. NO runtime deps. Raw .ts, no build step.
        │   (imported by both; imports neither app)
   ┌────┴─────┐
   ▼          ▼
apps/server   apps/web
Fastify +     React 18 / Vite 5 / Zustand.
DataProvider  ~231 lazy-loaded panels.
```

| Package | Name | Role | Runtime deps |
|---|---|---|---|
| `packages/shared` | `@midas/shared` | The TS **data contract** | **none** — no `dependencies` field at all (`packages/shared/package.json`) |
| `apps/server` | `@midas/server` | Fastify + pluggable `DataProvider` | `@fastify/cors`, `@fastify/websocket`, `ccxt`, `fastify`, `tsx`, `ws`, `@midas/shared` |
| `apps/web` | `@midas/web` | React/Vite/Zustand terminal UI | `lightweight-charts`, `react`, `react-dom`, `react-grid-layout`, `zustand`, `@midas/shared` |

**`shared` is not "types only" — it holds PURE LOGIC run by BOTH tiers.** This is
the single most misunderstood fact (`docs/ARCHITECTURE.md` still calls it "types
only"; **code wins**). The same functions execute in the server routes AND in the
in-browser demo:

- `computeFundingDispersion` / `computeOiConcentration` / `computeVenueArbRow`
  (`packages/shared/src/market.ts:389,461,155`) — imported by
  `apps/server/src/routes/market.ts:3-5` **and** called in
  `apps/web/src/demo/engine.ts:1,287,325`.
- `evaluateAlerts` (the edge-triggered alert fold, `packages/shared/src/alerts.ts:224`)
  — one implementation drives client and server so they never disagree.

**Why this matters for you:** a shape or logic change in `shared` moves **both**
sides at once (fan-in: **53** server files, **232** web files import `@midas/shared`).
That is also why **demo↔server fidelity** is a real contract (see
`midas-data-honesty-and-provenance`) and why the static-demo build is one of the
six gates — a change that only the demo path exercises can break there while the
normal build stays green.

**Rule of thumb:** *If a field crosses the wire, it starts in `@midas/shared`.*
Adding a data capability end-to-end touches: type in `shared` → method on
`DataProvider` + all providers → a route → the web `api` client.

---

## 2. The `DataProvider` seam — the pluggable data source

`apps/server/src/providers/types.ts:51-144` defines the one interface every
market-data capability is a method on. The web app **never** talks to an exchange
directly; it calls `apps/web/src/lib/api.ts` → a Fastify route → a `DataProvider`
method → a typed `@midas/shared` snapshot.

`createProvider(name)` (`providers/index.ts:13-26`) is a switch selected at boot by
`MIDAS_DATA_PROVIDER` (env table owned by `midas-config-and-flags`):

| Provider | `name` | `live` | What it is |
|---|---|---|---|
| `MockProvider` | `mock` | **`false`** | Deterministic synthetic market. The **default**; unknown ids fall back here with a warning. (`mock.ts:68-69`) |
| `YahooProvider` | `yahoo` | `true` | Live equities via Yahoo's public endpoints (live REST, no live stream). (`yahoo.ts:88-89`) |
| `CcxtProvider` | `ccxt:${id}` | `true` | Live multi-exchange crypto via CCXT. **The only source that streams live.** (`ccxt.ts:89,126`) |

Two subtleties the seam enforces:

- **`live` (REST liveness) ≠ stream liveness.** `providerStreamsLive(provider) =
  provider.name.startsWith('ccxt')` (`streaming.ts:52-53`) is the single source of
  truth for whether a live socket exists. A `yahoo` feed is `live=true` but shows
  `SIM` on the stream badge — honest by construction (mechanics: `midas-data-honesty-and-provenance`).
- **The two write methods are OPTIONAL and unreachable.** `placeOrder?` /
  `cancelOrder?` (`types.ts:134,140`) are the only writes on the interface; a
  provider that omits them cannot trade, and the execution hold (§3, invariant 2)
  makes them unreachable regardless.

### App layering (`buildApp`, `apps/server/src/app.ts:67-290`)
Registered in this deliberate order — each layer is a guard for the next:
`cors` (:87) → `websocket` w/ frame cap (:93) → baseline security headers on every
response (:98-102) → optional per-IP rate limiter, `/api/health` exempt on a
segment boundary (:106-125) → **auth guard** (:143) → **per-user key store +
provider pool** (:150-193) → `registerRoutes` (:195) → key/account/equity/system/
alert/snapshot routes (:196-255) → `registerStream` (:256) → a **message-sanitizing
error handler** that returns `'Internal Server Error'` for any unexpected 5xx so a
raw ccxt error (which can embed the signed request URL / API key) never reaches the
client (:258-278).

---

## 3. The six invariants — NEVER break these

Canonical list, each with its **rationale** and its **enforcement**. These are
codified in `REFACTOR_PLAYBOOK.md` Part 1 and `AGENTS.md`.

| # | Invariant | Why it exists | Enforced by |
|---|---|---|---|
| 1 | **Data honesty** | Honesty is the product — the trust wedge. | provenance unions in `shared`; `providerStreamsLive`; badge tests |
| 2 | **Non-custody** | A read-only terminal cannot lose your funds. | only two writes exist; execution hold returns 503 |
| 3 | **Base-58 case-sensitivity** | Uppercasing corrupts a valid Solana address. | `normalizeSolanaAddress` gate; edge tests |
| 4 | **Registration triad in sync** | Three independent maps keyed by `ModuleCode`; drift = broken panel. | CI parity test (`commands/registry.test.ts`) |
| 5 | **Perf budget 155 / 700 KB gzip** | Must open fast on hotel wifi; panels stay lazy. | `scripts/check-bundle.mjs` |
| 6 | **`@midas/shared` dependency-free** | Consumed as raw TS by Node **and** browser, no build step. | code review + typecheck in both apps |

**1. Data honesty.** Every snapshot carries `provenance: 'live' | 'synthetic' |
'unavailable'` and a `note: string | null`. Synthetic is **never** shown as live; a
real upstream failure degrades to `unavailable` — never a fabricated number, never a
stale value silently re-labeled. `live` (REST) and `streamLive` (WS) are
deliberately separate. *Mechanics, unions, the labeling checklist for any new
surface → `midas-data-honesty-and-provenance` (do not reinvent here).*

**2. Non-custody.** Exactly **two** exchange write calls exist in the whole
codebase: `createOrder` and `cancelOrder` in `apps/server/src/providers/ccxt.ts`
(the call sites: `ccxt.ts:783` and `ccxt.ts:765`; the comment at `ccxt.ts:771-772`
names them "one of the only two writes"). **Never add a third write, a signing path,
a `sendTransaction`, a swap-execute, or a withdrawal — anywhere, including tests and
demo code.** The Jupiter integration (`SJUP`) is quote-only. Both writes are
currently unreachable behind the **execution safety hold**: `POST /api/orders` and
`DELETE /api/orders/:id` return **503 `TradingSafetyHold` unconditionally**
(`routes/account.ts:95-109`) — no env flag, key, or `canTrade` lifts it. *(Older
docs say these writes are "env-gated behind `MIDAS_TRADING_ENABLED`" — that flag is
**legacy/ignored**; the hold supersedes it. Code wins.)* The re-enable gate is a
maintainer decision — owned by **`midas-change-control`**; the retraction story is
in **`midas-failure-archaeology`**.

**3. Base-58 is case-sensitive.** Solana addresses and mints are **never
uppercased**. API-edge validation uses `normalizeSolanaAddress` (trim + charset
check, `routes/shared.ts:54`), never `normalizeSymbol` (which uppercases tickers,
`routes/shared.ts:26-28`). The regex is `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/`
(`routes/shared.ts:46`). Only ticker *symbols* uppercase. Rationale in the code:
"base-58 is CASE-SENSITIVE — uppercasing corrupts a valid address."

**4. The registration triad stays in sync.** A panel exists in three files; never
edit one leg without the others. See the runbook in §4 — this is the single
most-touched seam and the #1 structural trap.

**5. Perf budget.** Main bundle ≤ **155 KB** gzip, total JS ≤ **700 KB** gzip,
enforced by `node scripts/check-bundle.mjs` (thresholds at `check-bundle.mjs:17-18`)
run **from the repo root** after a build. Panels stay lazy-loaded (`mod()` in
`registry.tsx`) — **never import a panel eagerly from shared code**, or it lands in
the main chunk and blows the budget. *How to measure it → `midas-diagnostics-and-tooling`.*

**6. `@midas/shared` stays dependency-free.** It is consumed as **raw TypeScript
source** by both the Fastify server (via `tsx`) and the Vite web client (via alias),
so anything imported here must be safe in **both** Node and browser environments —
and there is no build step to shim a dependency. `packages/shared/package.json` has
no `dependencies` or `devDependencies` block; the barrel comment
(`packages/shared/src/index.ts:4-6`) states the rule. Do not add a runtime import.

---

## 4. Runbook — add a panel (the registration triad)

This is the most dangerous routine change because a panel lives in **three
independent maps keyed by `ModuleCode`**, and nothing but the CI parity test catches
drift. Miss a leg and you ship a runtime "Unknown module" (missing component) or a
dead command. *(For diagnosing an already-broken panel, see the "triad out of sync"
symptom in `midas-debugging-playbook`.)*

The three legs (all under `apps/web/src`):

| Leg | File | What you add |
|---|---|---|
| A. Metadata | `modules/meta.ts` | the code in the `ModuleCode` union **and** a `MODULE_META` entry `{code,title,w,h,minW,minH}` |
| B. Component | `modules/registry.tsx` | a `MODULE_COMPONENTS` entry: `mod(() => import('./XModule'), 'XModule')` |
| C. Command | `commands/registry.ts` (via a group file) | a `CommandDef` that opens the module |

**Step 0 — pure logic first (house pattern).** Extract the panel's math into a pure
`lib/<name>.ts` with a `lib/<name>.test.ts`. Web tests run with `environment: 'node'`
and **cannot render React** — so all logic that needs a unit test lives in `lib/*`,
not the component. *(Test conventions owned by `midas-validation-and-qa`.)*

**Step 1 — the component.** Create `modules/<Name>Module.tsx` exporting a **named**
component (matching the string you pass to `mod()`) that takes
`ModuleProps { panel: PanelState }` and reads `panel.symbol` / `panel.params`. Give
it an honesty badge and a read-only footer (copy the nearest existing module).
*(Provenance badge helpers → `midas-data-honesty-and-provenance`.)*

**Step 2 — leg A, `modules/meta.ts`:**
```ts
// add to the ModuleCode union
  | 'XCODE'
// add to MODULE_META
  XCODE: { code: 'XCODE', title: 'My Panel', w: 6, h: 8, minW: 3, minH: 4 },
```

**Step 3 — leg B, `modules/registry.tsx`:**
```ts
  XCODE: mod(() => import('./MyPanelModule'), 'MyPanelModule'),
```
`mod()` wraps `React.lazy` to load the named export as its own Vite chunk — this is
what keeps the panel lazy and the bundle within budget (invariant 5).

**Step 4 — leg C, the command.** Commands are assembled in `commands/registry.ts`
from per-theme groups (`commands/groups/{market,quant,platform,boards,utility}.ts`,
spread in that order — `registry.ts:29-35`). Add a `CommandDef` to the appropriate
group file:
```ts
{ code: 'XCMD', aliases: [], title: 'My Panel',
  module: 'XCODE', requiresSymbol: true,
  description: 'One clear sentence, MORE than 20 characters — the test checks this.' },
```

**Step 5 — run the parity test + the gates.**
```bash
cd /home/user/Midas/apps/web && npx vitest run src/commands/registry.test.ts
```
The parity guard (`apps/web/src/commands/registry.test.ts`) enforces, at CI:
- **no duplicate token** across all codes + aliases (a later duplicate silently
  steals the token — the real bug it was written for: typing `VAR` opened Chande
  VIDYA instead of Value-at-Risk);
- **every command's `module` exists in `MODULE_META`** (catches a missing leg A);
- every command has a non-empty title and a `description.trim().length > 20`.

Then run the full six gates before committing (owned by `midas-validation-and-qa`;
CI order owned by `midas-build-and-env`). Ship it as **one single-concern draft PR**
per `midas-change-control`.

> Note: the parity test proves *command → meta* consistency. It does **not** by
> itself prove leg B exists — a `ModuleCode` in `meta.ts` with no
> `MODULE_COMPONENTS` entry is a TS error (the record is typed
> `Record<ModuleCode, …>`), so **typecheck** is the guard for leg B. Run both.

---

## 5. Known-weak points (stated plainly)

- **The triad is the structural sore.** ~231 panels × 3 legs, most-touched seam in
  the repo. The parity test + typecheck catch most drift, but adding a panel is
  still the change most likely to ship half-wired. Follow §4 exactly.
- **`ccxt.ts` is the untamed chunk (~964 loc).** Giant-file splits shrank the
  registry/routes/shared/mock files 10–40×, but `ccxt.ts` stayed big — it is the
  error-sanitization chokepoint (raw upstream errors can embed API keys). Touch it
  carefully; the read-path sanitization was a real disclosure fix.
- **`trading.ts` is DEAD scaffolding.** The live-trading subsystem was retracted to
  a fail-closed 503 (commit `0b83c4f`). Its pure gate helpers remain, unreachable,
  "for repair/tests only." **Do not try to "finish" trading** — it is a
  maintainer-gated fork behind the hold. Full chronicle: `midas-failure-archaeology`.
- **Security review is explicitly incomplete** (`REFACTOR_PLAYBOOK.md` Task 1.4,
  lines 218-226 — the review hit a spend cap at 8/38 agents, a 4th finding was
  lost, and 6 finder lenses never ran). Do not treat the security work as "done."
  This is a settled battle owned by **`midas-failure-archaeology`** (Battle 3) —
  cite the playbook, **not** `SECURITY_HARDENING.md`, which does not itself record
  the incompleteness. Do not re-own the detail here.
- **Doc-vs-code drift is real; code wins.** Known drifts: `ARCHITECTURE.md` says
  `shared` is "types only" (it holds pure logic) and cites "four gates" (there are
  six local + `test:reviewer` in CI); `MIDAS_TRADING_ENABLED` framing is legacy.
  When docs and code disagree, trust the code and report the drift
  (`midas-docs-and-writing`).

---

## When NOT to use this skill (use the sibling instead)

| You need… | Use |
|---|---|
| Provenance MECHANICS (unions, live/streamLive/SIM, labeling a new surface) | `midas-data-honesty-and-provenance` |
| The execution-hold RE-ENABLE gate / how a change is classified & gated | `midas-change-control` |
| The env var table, defaults, or how to add a flag | `midas-config-and-flags` |
| The "triad out of sync" / "Unknown module" SYMPTOM & fix | `midas-debugging-playbook` |
| The six gates, how to add tests, web-no-DOM detail | `midas-validation-and-qa` |
| The exact CI gate order, pnpm/node pins, env recreation | `midas-build-and-env` |
| How to MEASURE the bundle / run diagnostics | `midas-diagnostics-and-tooling` |
| The live-trading retraction STORY / dead scaffolding | `midas-failure-archaeology` |
| Domain math (funding/OI/liquidation formulas) | `crypto-market-reference` |

This skill owns the **what & why** of the structure and the **add-a-panel** runbook.
Behavior changes and promotion always route through `midas-change-control`.

---

## Provenance and maintenance

Every volatile fact below is date-stamped **2026-07-19** with a one-line
re-verification command (run from repo root `/home/user/Midas`). Re-verify before
relying on a number; the design contract itself changes rarely, the counts change
often.

| Fact (as of 2026-07-19) | Re-verify |
|---|---|
| `@midas/shared` has **no** `dependencies`/`devDependencies` block | `cat packages/shared/package.json` |
| Triad is exactly in sync: **231** entries each | `grep -cE "^\s+\| '" apps/web/src/modules/meta.ts; grep -cE "mod\(\(\) =>" apps/web/src/modules/registry.tsx` |
| **233** commands across the group files | `grep -rcE "code: '" apps/web/src/commands/groups/ \| awk -F: '{s+=$2} END{print s}'` |
| Perf budget thresholds **155 / 700 KB** gzip | `grep -nE "_BUDGET_KB" scripts/check-bundle.mjs` |
| Current bundle **~139.3 / ~615.4 KB** gzip (a measurement, not the budget) | build web, then `node scripts/check-bundle.mjs` from repo root (see `midas-diagnostics-and-tooling`) |
| Exactly two exchange writes: `createOrder`/`cancelOrder` in `ccxt.ts` | `grep -rnE "this\.exchange\.(createOrder\|cancelOrder\|withdraw)" apps/server/src/providers/ccxt.ts` |
| Execution hold: 503 `TradingSafetyHold`, both order routes | `sed -n '95,109p' apps/server/src/routes/account.ts` |
| `DataProvider` interface + `placeOrder?`/`cancelOrder?` optional | `sed -n '51,144p' apps/server/src/providers/types.ts` |
| Provider `live` flags: mock=false, yahoo/ccxt=true; default `mock` | `grep -nE "readonly (name\|live)" apps/server/src/providers/{mock,yahoo,ccxt}.ts; grep -n MIDAS_DATA_PROVIDER apps/server/src/config.ts` |
| Base-58 gate is case-preserving (`normalizeSolanaAddress`) | `sed -n '45,57p' apps/server/src/routes/shared.ts` |
| Parity test enforces the triad | `npx vitest run apps/web/src/commands/registry.test.ts` (from `apps/web`) |
| Fan-in: 53 server / 232 web files import `@midas/shared` | `grep -rlE "from '@midas/shared'" apps/server/src \| wc -l; grep -rlE "from '@midas/shared'" apps/web/src \| wc -l` |

`MIDAS_VERSION` is `0.5.0`, defined once in `packages/shared/src/system.ts:12`
(not `index.ts`; the `shared` package.json `version` field is a separate `0.1.0`).
License: **AGPL-3.0-only**. There is **no lint gate** — never run `pnpm lint`.
