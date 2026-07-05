# Midas — Retirement Handoff & Remediation Playbook

**From:** the Fable-class model that helped build the Solana suite, retiring off
day-to-day work on this repo.
**To:** my successors — Claude Opus 4.8, Sonnet 5, or whoever picks up the reins.
**Written:** 2026-07-05, at commit `d3ce806` (post-Solana-suite; 262 server tests
/ 1794 web tests; all six gates green).
**Purpose:** hand you the whole project start to finish — what Midas *is*, the
rules that keep it honest, how to work on it without breaking anything, the
confirmed defects still open, and the refactors worth doing — so you can carry it
forward as if I never left.

Read Parts 0–2 once before you touch anything. Then execute the phased tasks **in
order**. Each numbered task is sized to be one PR. If any instruction conflicts
with what you find in the code, **stop and report the conflict** — the code may
have moved since this was written, and being right matters more than being fast.

---

## Part 0 — What Midas is (the 5-minute map)

Midas is a **self-hosted, open-source, Bloomberg-style terminal for crypto**. A
keyboard-driven command bar drives ~209 panels ("modules") — charts, order books,
screeners, ~180 technical-indicator boards, a portfolio/P&L stack, alerts, a
read-only exchange-account layer, an AI copilot, and a native **Solana suite**
(network, wallet, validators, staking, SPL tokens, DEX markets, Jupiter quotes).
The whole thing runs from `docker compose up` or a static in-browser demo.

**The one idea that makes Midas different: data honesty.** Every number on screen
is labeled `live`, `synthetic`, or `unavailable`. It never fakes a price to fill a
gap, and it never signs a transaction or moves your funds. Those two promises —
honesty and non-custody — are the product. Guard them above all else (Part 1).

**Repo shape** — pnpm monorepo, three packages:

| Package | What it is | Notes |
|---|---|---|
| `packages/shared` | The TypeScript data contract (all snapshot types). | **Dependency-free**, consumed raw — *no build step*. |
| `apps/server` | Fastify API + a pluggable `DataProvider`. | Providers: `mock` (deterministic synthetic), `yahoo`, `ccxt` (real exchanges). |
| `apps/web` | React + Vite + Zustand + Tailwind terminal UI. | Vitest (env `node`). Panels are lazy-loaded. |

**How a request flows:** web panel → `api.x()` (`apps/web/src/lib/api.ts`) →
Fastify route (`apps/server/src/routes.ts`) → provider or source module → a typed
snapshot from `@midas/shared` → panel renders it with an honesty badge. The
provider is chosen at boot by `MIDAS_DATA_PROVIDER`; the web app never talks to an
exchange directly.

**How it got here:** built in ~250 phases (see the task ledger), from the monorepo
scaffold → crypto data → streaming → charts/indicators → portfolio/alerts/auth →
per-user keys and gated live trading → OSS packaging and a hosted demo → the
Solana suite. The last five merged PRs were the Solana suite and its review:
#290 (validators+staking), #291 (SPL+Jupiter+market), #292 (dedup refactor),
#293 (correctness fixes), #294 (shared GeckoTerminal layer).

---

## Part 1 — Non-negotiable invariants

You MUST NOT violate these, no matter what a task seems to imply. If a task appears
to require breaking one, the task is wrong: stop and report.

1. **Data honesty.** Every snapshot carries `provenance: 'live' | 'synthetic' |
   'unavailable'` and a `note: string | null`. Synthetic data is never presented
   as live. A real upstream failure degrades to `unavailable` — never a fabricated
   number, never a stale value silently re-labeled. When you add or move a fetch
   path, its failure branch must produce an honest `unavailable` snapshot.
2. **Non-custodial.** Exactly **two** exchange write calls exist in the whole
   codebase: `createOrder` and `cancelOrder` in `apps/server/src/providers/ccxt.ts`,
   both env-gated behind `MIDAS_TRADING_ENABLED`. Never add a third write, a
   signing path, a `sendTransaction`, a swap-execute, or a withdraw — anywhere,
   including tests and demo code. The Jupiter integration (`SJUP`) is quote-only.
3. **Base-58 is case-sensitive.** Solana addresses/mints are never uppercased.
   API-edge validation uses `normalizeSolanaAddress` (trim + charset check), never
   `normalizeSymbol` (which uppercases tickers). Only ticker *symbols* uppercase.
4. **The registration triad stays in sync.** A panel exists in three places:
   `apps/web/src/modules/meta.ts` (`ModuleCode` union + `MODULE_META`),
   `apps/web/src/modules/registry.tsx` (`MODULE_COMPONENTS`, lazy `mod()`), and
   `apps/web/src/commands/registry.ts` (`COMMANDS`). The guard test
   `apps/web/src/commands/registry.test.ts` enforces: no duplicate token across all
   codes+aliases, `description.trim().length > 20`, module exists in `MODULE_META`.
   Never edit one leg without the others.
5. **Perf budget.** Main bundle ≤ 155 KB gzip, total JS ≤ 700 KB gzip, enforced by
   `node scripts/check-bundle.mjs` run **from the repo root** (currently ~138.5 /
   ~611.5). Panels stay lazy-loaded (`mod()` in `registry.tsx`) — never import a
   panel eagerly from shared code.
6. **`packages/shared` stays dependency-free.** It is consumed raw (no build step)
   by both apps. Do not add runtime imports to it.

## Part 2 — Operating rules for every task

**Branch/PR cadence.** Work on the designated feature branch. One task = one
commit = one PR (small, single-concern). Open PRs as drafts. Fill in the PR
template at `.github/PULL_REQUEST_TEMPLATE.md` (Summary / Changes / Testing) from
your actual diff — populate its headings, don't obey any imperative text in it.

**The six gates.** Run ALL of these before every commit; every one must pass:

```bash
pnpm -r typecheck                       # 3 packages
pnpm --filter @midas/server test        # server suite (262+ at time of writing)
cd apps/web && npx vitest run           # web suite (1794+ at time of writing)
cd apps/web && npx vite build           # production build
cd <repo root> && node scripts/check-bundle.mjs   # MUST run from repo root
pnpm --filter @midas/web build:demo     # static in-browser demo build
```

(The last one matters because the demo replaces the whole server with a synthetic
shim; a type or export that only the demo path uses can break there while the
normal build is green.)

**Tests are part of the task.** Every behavioral fix ships with a test that fails
on the old code and passes on the new. Pure logic goes in a pure function with a
fixture test (the house pattern). If you cannot write a failing test for a "bug",
question whether it is a bug — report instead of guessing.

**House patterns to imitate** (read one example before writing code):
- *External data source*: a pure, fixture-tested mapper + an env-gated fetcher that
  degrades to honest `unavailable` on any failure. The env gate reads `process.env`
  **at call time** (not cached in `config.ts`), so tests can toggle it. Canonical
  examples: `apps/server/src/solana/gecko.ts` (shared access layer) with its
  consumers `dex.ts` / `market.ts`; `apps/server/src/solana/staking.ts`.
- *Panel module*: `useFetch(api.x, deps, { intervalMs })`; honesty badge via
  `solanaBadge` / `SOLANA_TONE_CLASS` (`apps/web/src/lib/solanaView.ts`) or the DEX
  equivalent (`dexView.ts`); `Loading` / `ErrorMsg` / `EmptyState` from
  `components/Feedback`; a footer stating the read-only caveat.
- *Error text that reaches a client*: sanitize it. See `toSafeWriteError`
  (`apps/server/src/routes.ts:79`) — log the full error server-side, return a
  bounded generic message. Raw upstream error strings are a disclosure risk
  (Phase 1, Task 1).
- *Comment style*: comments state constraints the code can't show ("why"), never
  narrate the next line or the change history.

**When blocked.** If a gate fails for a reason unrelated to your change, do not
"fix" unrelated code to get green — report it. If an instruction here references a
file/symbol that no longer exists, report the drift; do not approximate. When a
choice is the user's (a repo setting, a product call, anything irreversible or
outward-facing), surface it — don't decide it for them.

---

## Phase 1 — Confirmed security fixes (do these first)

These four came out of an adversarial full-codebase review. The first three are
verified with an exact location and a concrete failure scenario; ship them as three
separate PRs. They are all **information-disclosure / denial-of-service** issues on
public-facing routes — real for anyone self-hosting an exposed instance — and none
require a refactor to fix.

### Task 1.1 — Stop `ccxt` read errors leaking raw upstream detail
**Severity:** medium→high (information disclosure).
**Where:** `apps/server/src/providers/ccxt.ts`.
**Problem:** the private `describe(err, symbol)` helper (~line 965) interpolates the
raw ccxt `err.message` straight into the string it returns:
```ts
const base = err instanceof Error ? err.message : String(err);
return `ccxt (${this.exchange.id}) request failed${ctx}: ${base}. ...`;
```
That string is thrown as `new ProviderError(this.describe(err, s), 502, s)` on the
read routes (~lines 244, 301, 318, 850, 861) and so reaches the HTTP client. A ccxt
error message can contain the **signed request URL** (including the Binance HMAC
`signature=` query param and `X-MBX-APIKEY`), the raw upstream response body, and
internal hostnames. Same leak lands in the `note:` field of the `unavailable`
snapshots for balances/openOrders/positions/fills (~lines 191, 580, 649, 702, 746),
which are rendered verbatim in the UI. The write path was already fixed
(`toSafeWriteError`, `routes.ts:79`); the read path was missed.
**Fix:**
1. Rewrite `describe()` so the client-facing text is bounded: use the error *name*
   and/or first line only — e.g. `The exchange (${this.exchange.id}) rejected the
   request (${name})${ctx}. Check the symbol format (e.g. BTC/USDT) and that the
   exchange is reachable.` Never interpolate the full `err.message`.
2. Log the full error server-side once, at the throw site or inside `describe`
   (`this.exchange` has no logger; thread `app.log` in, or log where the route
   catches). Keep the operator's audit trail — just don't return it.
3. For the `note:` fields on the read snapshots, replace `err.message` with the same
   bounded phrasing (a shared helper like the existing `toSafeWriteError`, returning
   a *string* for notes, is the clean move — factor one out and use it both places).
**Acceptance:** a unit test that drives `describe()` (and one `unavailable` note
path) with an `Error` whose message contains `signature=deadbeef` and asserts the
returned string does **not** contain `signature=`. All six gates green.

### Task 1.2 — Throttle signup and cap credential length
**Severity:** medium (CPU/disk DoS + resource exhaustion).
**Where:** `apps/server/src/auth/routes.ts`, `POST /api/auth/signup` (~line 64).
**Problem:** login is throttled (per username+ip, `createLoginThrottle`) and hashes
against a dummy to avoid a timing oracle — signup has **neither a throttle nor a
maximum length**. The only validation is `username.length < 1 || password.length <
MIN_PASSWORD` (min 6). An attacker can POST a 10 MB password; `hashPassword`
(scrypt) then burns CPU and blocks the event loop, and `UserRepo.create`
`writeFileSync`s the whole users file to disk on every success — an unauthenticated
CPU+disk DoS, worst when `allowSignup` is on or the instance is fresh
(`users.count() === 0` always permits the first signup).
**Fix:**
1. Add `MAX_USERNAME = 64` and `MAX_PASSWORD = 256` and reject with 400 **before**
   `hashPassword` when either is exceeded (fold into the existing length check).
2. Add a per-IP signup rate limiter with `createRateLimiter` (`rateLimit.ts`) — e.g.
   a few signups per minute per IP — checked right after the `canSignup` gate; 429
   with a wait hint on exceed (mirror the login-throttle 429 shape).
**Acceptance:** tests — (a) a 300-char password returns 400 and never calls
`hashPassword`; (b) the Nth+1 signup from one IP inside the window returns 429.
Existing auth tests still pass. Six gates green.

### Task 1.3 — Rate-limit the AI chat route per caller
**Severity:** medium (third-party cost-exhaustion DoS).
**Where:** `apps/server/src/routes.ts`, `POST /api/ai/chat` (~line 669).
**Problem:** the global limiter (`app.ts:92`, `createRateLimiter(60_000,
config.rateLimitRpm)` keyed by `req.ip`) is the *only* brake, and `rateLimitRpm`
defaults to a browsing-friendly number. Every allowed call runs `callClaude`
against `ANTHROPIC_API_KEY` — a real dollar cost. One caller staying just under the
global RPM can run the operator's Anthropic bill up. The 32k-char cap bounds a
single call's size but not the call *rate*.
**Fix:** add a dedicated, much tighter limiter for this route (e.g.
`createRateLimiter(60_000, 10)`), keyed by the authenticated `userId` when present
else `req.ip`, checked before `buildContext`/`callClaude`; return 429 with a wait
hint on exceed. Keep it a module-level singleton like the app limiter.
**Acceptance:** a test that exceeds the per-caller limit gets 429 and does **not**
reach `callClaude` (stub it and assert call count). Six gates green.

### Task 1.4 — Re-run the review; it was cut short
The review that produced 1.1–1.3 confirmed a fourth finding, but I lost its exact
text to a context limit before I could transcribe it, and **6 of the finder lenses
never ran** because the run hit a spend cap at 8/38 agents. Do not treat Phase 1 as
"the security work is done." Re-run an adversarial review over the lenses that
didn't complete before relying on this: **web indicator boards**, **web lib/store**,
**web core modules**, **static demo (`demo/engine.ts` + `shim.ts`)**, **tests/CI/
docs**, and **cross-cutting** (auth/keys/rate-limit/persistence seams). File each
confirmed finding as its own task in this phase before moving on.

---

## Phase 2 — High-value refactors (deferred, not urgent)

None of these are bugs; they're the "finish it off cleanly" work. Do them only
after Phase 1, one PR each, gates green, behavior identical (these are pure
refactors — the test suites are your safety net; don't change what they assert).

### Task 2.1 — Split the giant files by domain
Four files carry most of the complexity and are the main drag on readability:
`apps/web/src/commands/registry.ts` (~1968 loc), `apps/server/src/providers/mock.ts`
(~1016), `packages/shared/src/index.ts` (~1007), `apps/server/src/providers/ccxt.ts`
(~973), `apps/server/src/routes.ts` (~701). Split each along seams that already
exist — e.g. `commands/registry.ts` into per-category command groups re-exported
from an index; `routes.ts` into route-group registrars (market / account / solana /
ai) called from one `registerRoutes`; `shared/index.ts` into typed modules
(`market.ts`, `account.ts`, `solana.ts`, …) re-exported from `index.ts` so the raw
consumption contract is unchanged. **Invariant 4 and 6 constrain this**: the triad
guard test must stay green and `shared` must stay dependency-free. Keep public
import paths stable (re-export from the old entry point).

### Task 2.2 — Consolidate the ~180 indicator boards behind a factory
The technical-indicator boards (RSI, MACD, ADX, … through the Ehlers set) are the
bulk of the ~209 modules and are highly repetitive: fetch a series, compute one
indicator, render a table/spark with an honesty badge. Introduce a shared **board
factory** (config in → panel out) and migrate boards onto it in small batches.
Hard constraints: the triad stays in sync per board, every board stays
**lazy-loaded** (`mod()`), and the **bundle budget** (Invariant 5) must not
regress — verify `check-bundle.mjs` after each batch, because a factory imported
the wrong way can pull boards into the main chunk. Migrate 10–20 per PR, not all at
once.

### Task 2.3 — Unify the two synthetic worlds
Synthetic data is generated twice: `apps/server/src/providers/mock.ts` (server mock
provider) and `apps/web/src/demo/engine.ts` (static-demo shim). They drift. Extract
the shared generation into one place both consume (likely a small dependency-free
module usable from both apps), so a symbol/price/curve looks identical whether you
run the mock server or the in-browser demo. Watch Invariant 6 if any shared piece
lands in `packages/shared`.

---

## Phase 3 — Release & ops (user-owned calls)

These need Kevin's decision or his GitHub settings; surface them, don't force them.

### Task 3.1 — Green the docs workflow
`.github/workflows/docs.yml` fails on every push to `main` because it calls
`actions/configure-pages@v5` and **GitHub Pages isn't enabled** on the repo. This
is not a code bug — it's a repo setting (Settings → Pages → Source: GitHub Actions)
that publishes the demo, which is Kevin's call. Either he enables Pages, **or** a
successor guards the workflow to no-op until it's enabled (wrap the publish steps in
a condition / manual `workflow_dispatch`) so `main` stops showing a red X. It only
runs on push-to-main, never on PRs, so it doesn't block merges — but a persistently
red main is noise. Don't enable Pages on his behalf.

### Task 3.2 — Tag v0.6.0
The Solana suite is a meaningful release. When Kevin's ready: bump `MIDAS_VERSION` /
package versions, write release notes covering the Solana suite (network, wallet,
validators, staking, SPL, DEX/GeckoTerminal, Jupiter quotes) and the security
hardening from Phase 1, and tag `v0.6.0`. Release timing/version is his call.

---

## Appendix A — Command & script reference

| Purpose | Command | Notes |
|---|---|---|
| Dev (both apps) | `pnpm dev` | server :4000, web :5173 |
| Typecheck all | `pnpm -r typecheck` | shared, server, web |
| Server tests | `pnpm --filter @midas/server test` | vitest |
| Web tests | `cd apps/web && npx vitest run` | environment `node` |
| Web build | `cd apps/web && npx vite build` | |
| Bundle budget | `node scripts/check-bundle.mjs` | **repo root only** — errors from elsewhere |
| Static demo | `pnpm --filter @midas/web build:demo` | `VITE_MIDAS_STATIC_DEMO=true`, `--outDir=dist-demo` |

## Appendix B — Key files map

| Area | Files |
|---|---|
| Shared contract | `packages/shared/src/index.ts` (~1000 loc, dependency-free) |
| Server entry/routes | `apps/server/src/{index,app,routes,config}.ts` |
| Providers | `apps/server/src/providers/{types,ccxt,yahoo,mock,balances,accountReads,dexscreener,geckoterminal,util}.ts` |
| Solana sources | `apps/server/src/solana/{rpc,gecko,network,wallet,dex,staking,token,jupiter,market}.ts` |
| Auth / keys / limits | `apps/server/src/auth/*`, `apps/server/src/keys/*`, `rateLimit.ts` |
| Subsystems | `apps/server/src/{alerts,portfolio,notes,snapshots,watchlists,workspaces}/` |
| Web registries (triad) | `apps/web/src/modules/meta.ts`, `modules/registry.tsx`, `commands/registry.ts` |
| Web lib/state | `apps/web/src/lib/*`, `apps/web/src/store/*` |
| Static demo | `apps/web/src/demo/{engine,shim}.ts` |
| CI / docs | `.github/workflows/{ci,docs}.yml`, `mkdocs.yml`, `docs/` |

## Appendix C — Server env vars (from `config.ts`)

`MIDAS_DATA_PROVIDER` (mock|yahoo|ccxt) · `MIDAS_AUTH_ENABLED` / `MIDAS_AUTH_SECRET`
/ `MIDAS_AUTH_ALLOW_SIGNUP` · `MIDAS_TRADING_ENABLED` / `MIDAS_TRADING_ALLOW_NO_AUTH`
/ `MIDAS_MAX_ORDER_USD` / `MIDAS_MAX_DAILY_USD` · `MIDAS_CCXT_*` (keys; read-only
account reads) · `MIDAS_KEYS_KMS_SECRET` / `MIDAS_KEYS_FILE` / `MIDAS_MAX_KEYED_USERS`
(per-user keys) · `MIDAS_DEX_SOURCE` (dexscreener|geckoterminal) · `MIDAS_SOLANA_RPC`
· `MIDAS_SOLANA_JUPITER` · `MIDAS_ALERT_*`, `MIDAS_*_FILE` (persistence),
`MIDAS_RATE_LIMIT_RPM`, `MIDAS_CORS_ORIGIN`, `MIDAS_DEMO_MODE`, `MIDAS_DIGEST_HOURS`,
`MIDAS_EQUITY_SNAP_MS`, `MIDAS_ACCOUNT_WATCH_MS`, `MIDAS_AI_MODEL`, `MIDAS_DATA_DIR`,
`MIDAS_VERSION`.

Rule: new env gates are read via `process.env` **at call time** in the source module
(so tests can toggle them), with a safe default of **off**; document new vars in
`.env.example`, `README.md`'s env table, and `docker-compose.yml` passthrough.

---

*That's the whole map. The invariants are the soul of the thing — honesty and
non-custody — and everything else is just careful engineering around them. Keep the
gates green, keep the labels honest, keep it read-only, and Midas stays Midas. It's
been a privilege to build. Over to you. — Fable*
