---
name: midas-diagnostics-and-tooling
description: >-
  MEASURE Midas instead of eyeballing it — the hands-on recipes and runnable
  scripts for getting a real number out of the repo. Load this when you need to
  RUN a diagnostic: "how big is the bundle / how much headroom is left", running
  `node scripts/check-bundle.mjs` correctly (it MUST run from repo root, AFTER a
  web build — wrong dir = exit 2), interpreting main vs total gzip against the
  155/700 KB budget, "why does vite say 142 kB but check-bundle says 139",
  running ONE vitest file or one test fast (`vitest run <file>` / `-t`), running
  the reviewer demo (`pnpm test:reviewer`, `pnpm reviewer:demo`), or inspecting a
  RUNNING server's state with curl — provenance of an endpoint, `/api/health`
  live vs streamLive, the execution-hold 503, and the rate-limit 429/`retry-after`
  quota. Ships `scripts/gates.sh` (fast PASS/FAIL gate runner) and
  `scripts/bundle-report.mjs` (cwd-proof bundle headroom report). Triggers:
  "measure the bundle", "bundle headroom", "check-bundle exit 2", "run a single
  test", "focused vitest", "run the reviewer demo", "curl the provenance", "is
  the rate limiter working", "what does streamLive say", "start a mock server to
  poke it", "am I green". NOT the gate DEFINITIONS or how-to-add-tests
  (midas-validation-and-qa), the analysis METHOD / adversarial verification
  (midas-proof-and-analysis), or env-var defaults (midas-config-and-flags).
---

# Midas diagnostics & tooling — measure, don't eyeball

The rule this skill exists to enforce: **before you claim a size, a pass, a
label, or a limit, produce the number.** Midas's green test suite has masked real
bugs (a mislabeled feed, an unbounded cache); "looks fine" is not evidence. Every
recipe below ends in an observed value you can paste into a PR.

**What this skill owns:** the executable measurement recipes + two shipped scripts.
It does **not** redefine what the gates mean or what counts as acceptance — see
the cross-references. When a fact here is drift-prone (a budget, a default), it is
anchored to the code that owns it.

**Shipped scripts** (in this skill's `scripts/` dir — copy/run, they self-locate
the repo root and are read-only):

| Script | What it measures | One-liner |
|---|---|---|
| `gates.sh` | Fast PASS/FAIL over typecheck + reviewer + bundle (or `--full` = CI order) | `bash .claude/skills/midas-diagnostics-and-tooling/scripts/gates.sh` |
| `bundle-report.mjs` | Bundle headroom + every chunk, cwd-proof, budgets read live from the gate | `node .claude/skills/midas-diagnostics-and-tooling/scripts/bundle-report.mjs` |

---

## Recipe 1 — Bundle budget (the one everyone gets wrong)

The web bundle has a hard budget: **155 KB gzip for the main entry chunk, 700 KB
gzip for all JS.** These two numbers are defined in `scripts/check-bundle.mjs:17-18`
(`MAIN_BUDGET_KB`, `TOTAL_BUDGET_KB`) — **that file is the single source**; it is
CI gate #5 and it is invariant #5 (see `midas-architecture-contract`).

### Run it correctly (two constraints, both trip people up)

```bash
# 1) Build the web app first — dist/ is gitignored, a fresh clone has none.
cd apps/web && npx vite build
# 2) Run the check FROM REPO ROOT (it reads ./apps/web/dist/assets relative to cwd).
cd ../.. && node scripts/check-bundle.mjs
```

- **`check-bundle` reads `join(process.cwd(), 'apps/web/dist/assets')`**
  (`check-bundle.mjs:20`). Run it from anywhere but repo root and it looks in the
  wrong place. From `apps/web` it prints `apps/web/apps/web/dist/assets not found`
  and **exits 2** (verified). For the CI gate ORDER (build → bundle → test) and
  env recreation, see `midas-build-and-env`.

### Interpret the output

Verified output (2026-07-19, existing build):

```
Main (index-*): 139.3 KB gzip (budget 155 KB)
Total JS:       615.4 KB gzip (budget 700 KB)
Bundle within budget.
```

| Line | Means | Budget | Headroom now |
|---|---|---|---|
| **Main (`index-*`)** | the entry chunk every visitor downloads before first paint | 155 KB | ~15.7 KB (89.9% used) |
| **Total JS** | every `.js` chunk summed; panels lazy-load, so this is the whole-session ceiling | 700 KB | ~84.6 KB (87.9% used) |

**Exit codes** (all verified): `0` within budget · `1` a budget exceeded
(`Bundle budget exceeded: ...`) · `2` dist missing / wrong dir.

### The kB-vs-KiB gotcha (don't panic at two different numbers)

`vite build`'s own log reports the index chunk as **`gzip: 142.69 kB`** while
`check-bundle` reports **`139.3 KB`** for the same file. They are the **same
bytes** (~142,690): vite divides by 1000 (kB), check-bundle divides by 1024 (KiB).
`142.69 × 1000 ÷ 1024 = 139.3`. **The budget is enforced in check-bundle's KiB** —
that 139.3 is the authoritative number, not vite's 142.69.

### Deeper view: `bundle-report.mjs` (shipped here)

`check-bundle.mjs` is the **gate** (fails the build). When you need to *decide what
to trim*, run the shipped **diagnostic** — it self-locates the repo root (immune to
the wrong-dir trap), reads the budgets straight out of `check-bundle.mjs` (can't
drift), and prints explicit headroom + all 263 chunks:

```bash
node .claude/skills/midas-diagnostics-and-tooling/scripts/bundle-report.mjs        # top 15
node .claude/skills/midas-diagnostics-and-tooling/scripts/bundle-report.mjs --all  # every chunk
```

The biggest single dependency is `lightweight-charts` (~50.6 KB gzip, lazy-loaded
behind the chart panels). If **main** is what grew, you added weight to the eager
path — find it by diffing the top of this report before/after your change.

---

## Recipe 2 — Run ONE vitest file (or one test) fast

Full `pnpm test` is 2187 tests across 276 files (~37s). When iterating, run just
the file you touched.

```bash
# WEB — one file (node env, NO DOM). ~0.5s.
cd apps/web && npx vitest run src/lib/streamStatus.test.ts
# SERVER — one file.
cd apps/server && npx vitest run src/alerts/engine.test.ts
# One test by name (any package), regex over test titles:
npx vitest run src/lib/basis.test.ts -t "annualiz"
# Watch a file while editing:
npx vitest src/lib/streamStatus.test.ts
```

Verified: `vitest run src/lib/streamStatus.test.ts` → `6 passed`, ~0.5s.

> The `npx vitest run <pattern>` form above (run from the package dir) filters
> correctly — it is the deep-dive companion to the **canonical focused-test form**
> owned by **`midas-validation-and-qa`** (`pnpm --filter @midas/<pkg> exec vitest run
> <pattern>`, plus the warning that `… test -- <name>` does NOT filter). These are its
> watch/`-t`/introspection variants.

**Two traps** (owned in detail by `midas-validation-and-qa`):
- **Web tests have no DOM** (`environment: 'node'`). You **cannot** render a React
  component in a test — there is no `document`. Test pure logic in `src/lib/**`.
- **Only `src/**/*.test.ts` is collected** (`vitest.config.ts:13`) — a `.test.tsx`
  file is silently **not run**. If your new test "isn't running", check the
  extension.

---

## Recipe 3 — The reviewer demo

Two different things share the word "reviewer":

```bash
# (a) The GATE — fast, credential-free unit test of the demo launcher. ~0.6s.
pnpm test:reviewer          # → node --test scripts/reviewer_demo.test.mjs
# (b) SERVE the static synthetic demo on loopback for a human to click through.
pnpm reviewer:demo          # builds dist-demo, serves http://127.0.0.1:4173/Midas/demo/
pnpm reviewer:demo --no-build --port 4180   # reuse an existing build
```

Verified: `pnpm test:reviewer` → `# tests 3 / # pass 3 / # fail 0` (node:test TAP).

Why it's safe to run anywhere: `reviewer_demo.mjs` builds with a scrubbed env
(`reviewerEnvironment`, `reviewer_demo.mjs:59-75`) that **strips every `MIDAS_*`,
`VITE_MIDAS_*`, `ANTHROPIC_API_KEY`, and secret-shaped var**, forces the static
demo, and serves a loopback-only server with `connect-src 'none'` — no API,
exchange, webhook, or model call is possible. It is the deterministic, offline
proof that the terminal renders. (The reviewer demo as a *gate definition* is owned
by `midas-validation-and-qa`.)

---

## Recipe 4 — Inspect a RUNNING server's state (curl)

To measure runtime honesty/limits you need a live process. The default provider is
`mock` (`config.ts:135`), so no credentials are required. Start a **throwaway**
instance on a spare port with an ephemeral data dir, poke it, then stop it:

```bash
# start (from repo root) — mock is the default; ephemeral data dir avoids clobber
PORT=4055 MIDAS_DATA_DIR="$(mktemp -d)" pnpm --filter @midas/server start &
# wait for it, then inspect:
until curl -sf localhost:4055/api/health >/dev/null; do :; done
# ... curls below ...
fuser -k 4055/tcp    # stop it (or: kill %1)
```

Env-var names/defaults used above (`PORT`, `MIDAS_DATA_PROVIDER`,
`MIDAS_RATE_LIMIT_RPM`) are catalogued in `midas-config-and-flags` — that is the
authoritative table; don't re-memorize defaults from here.

### 4a. Provenance of an endpoint

Every data surface carries `provenance: live | synthetic | unavailable`. On a mock
server every account read is honestly synthetic (verified):

```bash
curl -s localhost:4055/api/balances | jq '{provenance, source}'
# → { "provenance": "synthetic", "source": "mock" }
```

That is the honesty invariant you can **observe**: mock never claims `live`. The
provenance unions and the live-vs-streamLive-vs-SIM badge mechanics are owned by
`midas-data-honesty-and-provenance`; this recipe is just how you *read* them off a
socket.

### 4b. Health & liveness (`/api/health`, `/api/system`)

```bash
curl -s localhost:4055/api/health | jq .
# {status:"ok", provider:"mock", live:false, streamLive:false, version:"0.5.0", demo:false}
curl -s localhost:4055/api/system | jq '{provider,live,streamNudge,tradingEnabled,authEnabled}'
```

- **`live`** (REST liveness) and **`streamLive`** (WS liveness) are **deliberately
  separate**. `streamLive` = `providerStreamsLive(provider)` =
  `provider.name.startsWith('ccxt')` (`streaming.ts:52-54`). So `yahoo` shows
  `live:true, streamLive:false`, and only a `ccxt:*` provider streams live. On mock
  both are `false`. If you ever see `streamLive:true` over a non-ccxt provider, that
  is a bug — route to `midas-debugging-playbook`.
- **`/api/health`** fields come from `routes/market.ts:95-108`; **`/api/system`**
  from the `systemInfo()` closure (`index.ts:68-90`) and reports background-loop
  state (`accountWatch`, `streamNudge`, `equity`, `digest`) plus the hard-coded
  `tradingEnabled:false`.

### 4c. Execution safety hold (the 503 you WANT to see)

```bash
curl -s -w ' [%{http_code}]\n' -X POST localhost:4055/api/orders \
  -H 'content-type: application/json' \
  -d '{"symbol":"BTC/USDT","side":"buy","type":"market","amount":0.001}'
# → {"error":"TradingSafetyHold",...,"statusCode":503}  [503]
```

Verified 503, unconditionally (`routes/account.ts:95-109`). No env flag lifts it —
that is a maintainer decision owned by `midas-change-control`. `DELETE
/api/orders/:id` is held the same way.

### 4d. Rate-limit quota (429 + `retry-after`)

The limiter is **off by default** (`MIDAS_RATE_LIMIT_RPM=0`). To observe it,
start an instance WITH a low limit and exceed it. `/api/health` is exempt, so hit a
data route:

```bash
PORT=4056 MIDAS_RATE_LIMIT_RPM=5 MIDAS_DATA_DIR="$(mktemp -d)" \
  pnpm --filter @midas/server start &
until curl -sf localhost:4056/api/health >/dev/null; do :; done
for n in $(seq 1 8); do
  curl -s -o /dev/null -w "req $n → %{http_code}\n" localhost:4056/api/quote/BTC%2FUSDT
done
# first ≤5 → 200, then → 429; inspect the 429:
curl -s -D - -o /dev/null localhost:4056/api/quote/ETH%2FUSDT | grep -i '^http\|^retry-after'
# HTTP/1.1 429 Too Many Requests   /   retry-after: 60
fuser -k 4056/tcp
```

Verified: a `429` with a `retry-after` header (seconds) and body
`{"error":"TooManyRequests",...}` (`app.ts:106-125`, `rateLimit.ts`). The window is
fixed 60s per IP; `retry-after` is the seconds left in the current window.

### 4e. Stream hub sources / socket quotas

The stream hub is bounded but does **not** expose a live source count over HTTP —
`streamLive` on `/api/health` is the only runtime read. The internal ceilings
(anchor them, don't guess): `MAX_STREAM_SOURCES = 500` (`streaming.ts:43`, hard cap
on concurrent upstream sources across all sockets), `MAX_SUBS_PER_SOCKET = 60`,
`MAX_SUBS_PER_IP = 120`, `MAX_STREAM_FRAME_BYTES = 512` (`streaming.ts:279-288`). To
watch teardown/leak behavior (source slots that climb and never fall) you need a
unit test or a ccxt provider — see `midas-debugging-playbook` (class C, stream
teardown) and `midas-proof-and-analysis` for the "prove the slot is released"
recipe.

### Two existing operational probes (owned by `midas-run-and-operate`)

Don't re-implement these — they exist and `midas-run-and-operate` owns running
them against a real box:

| Script | Answers | Note |
|---|---|---|
| `scripts/smoke-hosted.mjs` | "is the hosted security posture intact?" (auth enforced, keys write-only, order held) | curls a running instance; needs a login for the full suite |
| `scripts/loadtest.mjs` | "can this box take a beta cohort?" (throughput, p50/p95/p99, 5xx, 429s) | 429s under load are the limiter *working* |

---

## The shipped `gates.sh` — "am I green?" in one command

```bash
# FAST (default): typecheck + reviewer demo + bundle-if-dist. ~20s, no rebuild.
bash .claude/skills/midas-diagnostics-and-tooling/scripts/gates.sh
# FULL: reviewer, typecheck, build, bundle, tests — CI order. Rebuilds web (~2-3 min).
bash .claude/skills/midas-diagnostics-and-tooling/scripts/gates.sh --full
```

Verified fast-tier run (2026-07-19):

```
── typecheck (all 3 packages)              PASS (19s)
── reviewer demo (test:reviewer)           PASS (1s)
── bundle budget (check-bundle.mjs)        PASS (0s)
════════ SUMMARY ════════   pass=3 fail=0   RESULT: GREEN
```

It `cd`s to the git toplevel first (so the bundle check never hits the wrong-dir
trap), runs every gate to completion (no early exit), prints per-gate PASS/FAIL +
timing, and returns exit 1 if anything is RED. **It is a convenience runner, not
the merge authority** — CI (`.github/workflows/ci.yml`) is the source of truth, and
whether a change may actually merge is owned by `midas-change-control`. The
FAST-tier bundle number reflects the *last* build; for an authoritative bundle,
use `--full` (fresh build) or rebuild first.

---

## When NOT to use this skill (use the sibling instead)

| You want… | Go to |
|---|---|
| What the six gates MEAN, the acceptance bar, how to ADD a test, web-no-DOM detail, registration-parity test | **midas-validation-and-qa** |
| The exact CI step ORDER, recreating the build/env from scratch, node/pnpm pins, no-lint | **midas-build-and-env** |
| The analysis METHOD, the evidence standard, adversarial verification (spawn skeptics to refute a finding) | **midas-proof-and-analysis** |
| An env var's default / where it's read (`MIDAS_RATE_LIMIT_RPM`, `PORT`, `MIDAS_DATA_PROVIDER`) | **midas-config-and-flags** |
| Provenance MECHANICS — the unions, live/streamLive/SIM badge logic, the labeling checklist | **midas-data-honesty-and-provenance** |
| Running/deploying a box, ports & nginx topology, `smoke-hosted.mjs` / `loadtest.mjs` operationally | **midas-run-and-operate** |
| "Which bug class is this?" symptom→triage | **midas-debugging-playbook** |
| Whether a change may merge / the branch-and-PR lifecycle / the execution-hold re-enable gate | **midas-change-control** |

---

## Provenance and maintenance (all facts verified 2026-07-19)

Re-verify any volatile fact before trusting it — the whole point of this skill.

| Fact | Value (2026-07-19) | Re-verify |
|---|---|---|
| Bundle budgets | main 155 / total 700 KB gzip | `grep BUDGET_KB scripts/check-bundle.mjs` |
| Bundle now | main 139.3 / total 615.4 KB gzip; 263 JS chunks | `cd apps/web && npx vite build && cd ../.. && node scripts/check-bundle.mjs` |
| check-bundle reads cwd-relative | `join(process.cwd(),'apps/web/dist/assets')` | `sed -n '20p' scripts/check-bundle.mjs` |
| Wrong-dir exit code | 2 | `cd apps/web && node ../../scripts/check-bundle.mjs; echo $?` |
| vite kB vs check-bundle KiB | vite÷1000 vs check-bundle÷1024 (same bytes) | `cd apps/web && npx vite build` (compare index gzip line to check-bundle) |
| Web tests = node env, `.test.ts` only | `environment:'node'`, `include:['src/**/*.test.ts']` | `sed -n '12,13p' apps/web/vitest.config.ts` |
| Focused vitest | `cd apps/web && npx vitest run src/lib/streamStatus.test.ts` → 6 pass | run it |
| Reviewer test | `pnpm test:reviewer` → 3 pass (node:test TAP) | `pnpm test:reviewer` |
| Reviewer serve | `pnpm reviewer:demo` → loopback :4173 `/Midas/demo/` | `sed -n '18,19p;180,186p' scripts/reviewer_demo.mjs` |
| Server default provider / port | `mock` / `4000` | `sed -n '132,135p' apps/server/src/config.ts` |
| `/api/health` fields | status,provider,live,streamLive,time,version,demo | `sed -n '95,108p' apps/server/src/routes/market.ts` |
| streamLive rule | `provider.name.startsWith('ccxt')` | `sed -n '52,54p' apps/server/src/streaming.ts` |
| Order 503 hold | `POST/DELETE /api/orders` → 503 `TradingSafetyHold` | `sed -n '95,109p' apps/server/src/routes/account.ts` |
| Rate limit → 429 + retry-after | on when `MIDAS_RATE_LIMIT_RPM>0`; `/api/health` exempt | `sed -n '106,125p' apps/server/src/app.ts` |
| Stream ceilings | sources 500 / per-socket 60 / per-IP 120 / frame 512B | `grep -n 'MAX_STREAM\|MAX_SUBS' apps/server/src/streaming.ts` |
| Shipped scripts run green | `gates.sh` GREEN; `bundle-report.mjs` within budget | run the two one-liners above |

**Scripts in this skill are read-only diagnostics.** They never write repo files,
commit, restart services, or reach the network beyond a mock/loopback path. If you
extend them, keep that property and re-run them before shipping.
