---
name: midas-failure-archaeology
description: >-
  Load BEFORE investigating, "finishing", reviving, or re-fighting anything in Midas that
  looks unfinished, dead, over-large, or broken — this is the chronicle of settled battles so
  no one re-fights a decided war. Answers: "why was live order execution removed / why does
  POST /api/orders return 503", "can I re-enable trading / finish the order subsystem", "why
  does apps/server/src/trading.ts exist if it's dead — is this code still used", "why is
  ccxt.ts ~964 lines / why wasn't it split like the other giant files", "was the security
  review ever finished / which security lenses never ran", "why are there zero TODO/FIXME in
  the source", "why are there no git tags / where is v0.6.0", "why is main CI red", "has this
  been tried before / is this a known dead end / rejected fix". Each entry is symptom → root
  cause → evidence (commit/file) → status (CLOSED / DEFERRED / NO-GO). Triggers: dead code,
  repair scaffolding, retraction, revert, walk-back, fail-closed, "is this abandoned",
  "present code vs live code". NOT for live bug triage (use midas-debugging-playbook) or the
  hold re-enable procedure (use midas-change-control).
---

# Midas failure archaeology — the chronicle of settled battles

**What this is.** A field of already-fought wars: big investigations, retractions, deferred
refactors, and deliberate non-actions in Midas, each recorded as **symptom → root cause →
evidence → status**. Read it before you "fix", "finish", or "clean up" something that looks
broken, dead, or half-done. Much of what looks like a bug or an oversight here is a **settled
decision** — reopening it wastes the session and can un-fix a safety retraction.

**The golden rule of this repo:** *present code ≠ live code.* Midas disposes of capability by
**neutralizing/gating it in place**, almost never by `git revert` or deletion. So dead code
sits in the tree looking alive. Always check whether the thing in front of you is a settled
battle **before** touching it.

## Status legend (every entry carries one)

| Status | Meaning | Your move |
|---|---|---|
| **CLOSED** | Fought and resolved; the resolution shipped and merged. | Don't reopen. Build on it. |
| **DEFERRED** | Known debt, intentionally not done yet; recorded in a doc. | Fine to pick up — as a scoped single-concern PR through `midas-change-control`. |
| **NO-GO** | Deliberately held closed; reopening needs a specific human-owned gate. | Do **not** route around it. It is a maintainer decision, not an engineering one. |

## How this repo disposes of things (read this first — it explains everything below)

Verify the disposal style yourself; it is the reason "dead" code looks live:

- **No `git revert` commits exist.** `git log -i --grep=revert` returns only false positives
  (e.g. `Phase 76: Trend / revert Hurst board` — "Revert" is an indicator name, not a revert).
- **Exactly one file deletion in 681 commits.** `git log --diff-filter=D --summary | grep delete`
  → only `apps/server/src/workspaces/routes.ts`, deleted in `7dd21f1` (Phase 18) — a **benign
  consolidation** (replaced by a shared `registerSnapshotRoutes()` factory), not a pain removal.
- **Therefore:** capability is retired by making it unreachable (a 503, a flag ignored, a pure
  helper kept "for repair") while the code stays in the tree. **Do not assume a file that
  compiles and has tests is a live code path.** Confirm reachability before you invest in it.

---

## Battle 1 — The live-trading subsystem retraction (the biggest walk-back) — NO-GO

Midas **built a complete live-order-execution subsystem and then retracted it to fail-closed.**
This is the single most important settled war in the repo. Do **not** try to "finish trading."

- **Status:** the retraction is **CLOSED** (shipped + merged). Re-enabling execution is **NO-GO**.
- **Symptom you'll see today:** `POST /api/orders` and `DELETE /api/orders/:id` return
  **`503 TradingSafetyHold`** unconditionally; `apps/server/src/trading.ts` is full of trading
  logic (ledgers, idempotency cache, order validation) that looks live but is never reached for
  a real write. A new engineer thinks trading is "almost done" and tries to wire it up.
- **What was built (build-up chain, all authored by Claude, 2026-06-29 → 07-02):**

  | Commit | Phase | What it added |
  |---|---|---|
  | `3361721` | 233 (B1) | read-only exchange balances |
  | `a87d37f` | 234 (B2) | read-only open orders & positions |
  | `10ef633` | 235 (B3) | order ticket — preview only |
  | `89aecd4` | 236 (B4) | **live order placement (gated, opt-in, off by default)** |
  | `1b1d4dc` / `c428dfe` | Cycle 1/2 | completed the execution loop: cancel, fills, server-side idempotency |
  | `e084531` | — | per-user trading gates, scoped ledgers, per-user account loops |

- **The retraction:** `0b83c4f` **"fix: hold live execution fail closed"** (2026-07-09,
  authored by the maintainer, merged via **PR #306**, merge commit `cc1c2c0`). `git show 0b83c4f
  --stat`: **33 files, 446 insertions / 598 deletions** (net removal), and it **added
  `docs/EXECUTION_SAFETY_HOLD.md`**. Follow-up `07f2ff1` reports the caller account source while
  held. **A human made this call** — it is not an accident to be undone.
- **Root causes (the 5 correctness failures the retired write path had — `EXECUTION_SAFETY_HOLD.md:19-32`):**
  1. Idempotency + daily-exposure state lived **only in process memory** → a restart or a second
     replica resets or multiplies the controls.
  2. **Concurrent retries** could pass the idempotency check before either request recorded its result.
  3. **Timeout-after-acceptance:** the exchange could accept an order while the client timed out,
     leaving an unknown outcome a retry might duplicate.
  4. **USD-notional bug:** notional estimation multiplied base amount × pair price **without
     normalizing** arbitrary quote assets or derivative contract sizes to USD.
  5. **No hard max execution price** on market orders.
- **Current enforcement (verify, don't trust):** the 503 is returned from
  `apps/server/src/routes/account.ts` (`error: 'TradingSafetyHold'`, ~line 96), using
  `executionSafetyHoldStatus()` imported from `../trading`. **No env flag, operator key, stored
  user key, or `canTrade` value bypasses it** (`EXECUTION_SAFETY_HOLD.md:8-14`). The legacy
  `MIDAS_TRADING_ENABLED` / `MIDAS_MAX_ORDER_USD` / `MIDAS_MAX_DAILY_USD` flags are retained for
  compatibility/repair tests and are **ignored** by the hold (`SECURITY_HARDENING.md:52-55`).
- **What this means for you now:** treat execution as closed. If someone asks to re-enable it,
  that is the **9-item re-enable gate** in `EXECUTION_SAFETY_HOLD.md:33-46`, which is a
  **maintainer decision** — its procedure is owned by **`midas-change-control`** (do not
  re-derive or route around it here).

### Battle 1b — `trading.ts` is DEAD "repair scaffolding" (the #1 "is this code live?" trap)

- **Status:** intentional — **NO-GO to treat as live**.
- **Symptom:** `apps/server/src/trading.ts` (298 loc) exports `computeTradingStatus`,
  `createDailyLedger`, `createScopedDailyLedgers`, `checkDailyCap`, `validateOrderRequest`,
  `estimateNotionalUsd`, `createIdempotencyCache`, `mapPlacedOrder` — all pure, all tested. It
  reads like a working trading engine.
- **Root cause / evidence:** it is deliberately kept as **repair scaffolding**, not authority.
  `apps/server/src/trading.ts:23-30` states verbatim: *"Legacy live-trading gate calculations
  retained for repair work and tests. HTTP execution is held unconditionally by
  `executionSafetyHoldStatus`; these calculations must not be used to make provider writes
  reachable."* `EXECUTION_SAFETY_HOLD.md:48-49` repeats: *"The legacy pure gate helpers in
  `apps/server/src/trading.ts` are repair scaffolding only."*
- **Your move:** you may **read** these helpers to understand the intended design or to satisfy
  the re-enable gate's requirements, but **wiring any of them to a provider write re-opens the
  retracted subsystem** — that is the NO-GO in Battle 1. Do not "hook it back up."

---

## Battle 2 — The giant-file split campaign (mostly CLOSED; ccxt.ts still DEFERRED)

`REFACTOR_PLAYBOOK.md` Task 2.1 flagged five oversized files. A refactor wave split four of them
by domain (10-40× shrink), **but `ccxt.ts` resisted and is still ~964 loc.** Know which is done.

| File | Before | Now | Split commit | Status |
|---|---|---|---|---|
| `apps/web/src/commands/registry.ts` | ~1968 | **48** | `0038dca` (per-theme groups) | **CLOSED** |
| `apps/server/src/routes.ts` | ~701 | **25** | `7c8d217` (per-domain registrars) | **CLOSED** |
| `packages/shared/src/index.ts` | ~1007 | **22** | `e40b0d3` (domain modules) | **CLOSED** |
| `apps/server/src/providers/mock.ts` | ~1016 | **149** | `a7c6f74` (per-domain modules) | **CLOSED** |
| `apps/server/src/providers/ccxt.ts` | ~973 | **964** | `2912ff3` (dedup) + `eb9ae14` (extract `ccxt/helpers.ts`) | **DEFERRED** |

- **Symptom:** `ccxt.ts` is the largest single file and barely moved despite the campaign.
- **Root cause — why ccxt.ts won't shrink:** it is the **error-sanitization chokepoint**. Every
  provider error is routed through `safeErrorLabel()` (used at `ccxt.ts:164,541,621,674,727`;
  the "strip it" comment is at `:750`) so raw upstream detail (signed URLs, `X-MBX-APIKEY`,
  `signature=`) never reaches a client. The only extraction so far moved the *stateless* helpers
  to `apps/server/src/providers/ccxt/helpers.ts` (`safeErrorLabel`, `toPerpSymbol`,
  `isKnownExchange`, re-exported at `ccxt.ts:65`). The stateful method body — including the two
  non-custody writes `cancelOrder` (declaration `ccxt.ts:760`, write call `:765`) and `createOrder`
  (`ccxt.ts:783`), flagged at `:771` as "one of the only two writes" — stays concentrated on
  purpose. (The two-writes invariant and its call-site anchors are owned by
  **`midas-architecture-contract`**, invariant #2, which pins the write call at `:765`.)
- **Your move:** treat `ccxt.ts` as the highest-complexity single file. It is safe to split
  further **only** if you preserve the invariant that every provider error still flows through
  `safeErrorLabel` — a new `throw` site that bypasses it re-opens the information-disclosure leak
  (`a545d84` was the original fix). The **live** version of that leak trap is owned by
  **`midas-debugging-playbook`** (bug class E).
- **Sibling deferred refactors (same campaign, still open — DEFERRED):** the ~180 copy-paste
  indicator boards behind a factory (Task 2.2 — `feec98c`'s `venueBoard()` for FUNDX/XARB/OIV is
  the first step); unifying the two synthetic worlds `mock.ts` vs `demo/engine.ts` (Task 2.3).

---

## Battle 3 — The security review is explicitly INCOMPLETE — DEFERRED / OPEN

**Do not tell anyone "the security work is done."** A remediation wave fixed many defects, but
the adversarial review that found them **never finished.**

- **Status:** the fixes that shipped are **CLOSED**; the review itself is **DEFERRED / OPEN**.
- **Symptom:** the repo looks hardened (many `harden:`/`fix(server):` security commits, a
  `SECURITY_HARDENING.md` that lists guarantees "verified by tests"). A reader concludes the
  security pass is complete.
- **Evidence it is NOT complete — and where that fact actually lives:** `REFACTOR_PLAYBOOK.md`
  **Task 1.4 (lines 218-226)**: the review *"hit a spend cap at 8/38 agents,"* a **4th confirmed
  finding was lost to a context limit**, and **6 finder lenses never ran.** ⚠️ **Doc caveat:**
  `docs/SECURITY_HARDENING.md` is the operator posture doc and does **not** itself flag this
  incompleteness — the incompleteness is recorded only in `REFACTOR_PLAYBOOK.md`. Cite the
  playbook, not `SECURITY_HARDENING.md`, for "the review is unfinished."
- **The 6 lenses that never ran** (from `REFACTOR_PLAYBOOK.md:222-224`):
  1. web indicator boards
  2. web `lib/`store
  3. web core modules
  4. static demo (`demo/engine.ts` + `demo/shim.ts`)
  5. tests / CI / docs
  6. cross-cutting seams (auth / keys / rate-limit / persistence)
- **What DID get fixed (so you know the completed part — all CLOSED):** `a545d84` ccxt read-error
  leak, `b150a47` signup throttle + credential-length cap, `9349fba` AI-chat per-caller rate
  limit, `c89d8c1` WebSocket frame-size cap (unauth OOM), `5fe721c` isolate unkeyed tenant
  account reads, `18cc19c` trust-proxy for real client IP, `ec0eaf3` atomic persistence +
  fail-closed auth store, `cb0bd8b`/`6b55d80` bound+isolate alert store, `e3f4d70` CSV
  formula-injection guard, `16f973d` stop internal-error leakage.
- **Your move:** if you're relying on Midas being reviewed, **the 6 lenses above are unaudited.**
  Running one is a legitimate scoped task; report each confirmed finding as its own PR through
  `midas-change-control`. (Aside: `SECURITY_HARDENING.md:115` says "the four gates" — a known
  doc drift; the merge bar is **six** local gates + `test:reviewer`, owned by
  `midas-validation-and-qa`.)

---

## Battle 4 — Zero TODO/FIXME in source is DELIBERATE — CLOSED (a convention, not a gap)

- **Status:** **CLOSED** — an intentional discipline. The danger is *misreading* it.
- **Symptom / trap:** `grep -rE "TODO|FIXME|HACK|XXX"` over `apps/` + `packages/` returns
  **nothing** (verified: 0 occurrences in `*.ts`/`*.tsx`). A new engineer concludes "clean
  slate, no known debt." **Wrong.**
- **Root cause:** `REFACTOR_PLAYBOOK.md:131-132` mandates the comment style — *comments state
  constraints the code can't show ("why"), never narrate the next line or change history.* Debt
  is recorded in **prose docs, not inline markers.**
- **Where the real "issue tracker" lives (read these, not `grep TODO`):**
  `docs/EXECUTION_SAFETY_HOLD.md` (the NO-GO gate), `REFACTOR_PLAYBOOK.md` (confirmed defects +
  deferred refactors + ops calls), `docs/MAINTENANCE.md` (invariants + gates),
  `docs/SECURITY_HARDENING.md`, `docs/REVIEWER-GUIDE.md`, `AGENTS.md`.
- **Your move:** to find known debt, read the docs above. Do not add a `TODO` comment — encode
  the constraint in prose or a doc instead.

---

## Battle 5 — No git tags despite a documented release process — DEFERRED (user-owned)

- **Status:** **DEFERRED** — a maintainer's release-timing call, not a code bug.
- **Symptom:** `git tag` is **empty** (0 tags) even though `docs/MAINTENANCE.md:48-57` documents a
  full tag-release procedure (`git tag -a vX.Y.Z <merge-commit> && git push origin vX.Y.Z`) and
  `REFACTOR_PLAYBOOK.md:284-288` (Task 3.2) asks for `v0.6.0`.
- **Root cause / evidence:** releases are cut in `CHANGELOG.md` (top is `[Unreleased]` then
  `[0.5.0] — 2026-07-02`) but the git tag step is Kevin's call and hasn't been taken. Not lost
  work — an unexercised process step.
- **Your move:** don't invent a tag or "fix" this. `MIDAS_VERSION` (single-sourced in
  `packages/shared/src/system.ts`, currently `0.5.0`) is the version of record; the missing tag
  is expected. Tagging `v0.6.0` is a deliberate release action for the maintainer.

---

## Battle 6 — main CI shows red — CLOSED as a known non-bug (repo setting)

- **Status:** **CLOSED** (understood, intentionally not code-fixed). Don't debug it.
- **Symptom:** the default branch shows a red X in GitHub. Panic that main is broken.
- **Root cause / evidence:** `.github/workflows/docs.yml` fails on every push to `main` because it
  calls `actions/configure-pages@v5` and **GitHub Pages isn't enabled** on the repo
  (`REFACTOR_PLAYBOOK.md:274-282`, Task 3.1). It runs **only on push-to-main, never on PRs**, so
  it does **not** block merges. The real merge gate is the `ci.yml` job.
- **Your move:** ignore the docs workflow's red. It's a repo-settings call (enable Pages, or guard
  the workflow) that is **Kevin's** to make — don't enable Pages on his behalf. Judge health by
  the `ci.yml` run, not the docs one. (CI gate order is owned by `midas-build-and-env`.)

---

## Quick lookup — is my war already settled?

| If you're about to… | It's settled — see | Status |
|---|---|---|
| Re-enable order execution / make `POST /api/orders` work | Battle 1 + `EXECUTION_SAFETY_HOLD.md` | **NO-GO** |
| "Finish" or wire up `trading.ts` | Battle 1b | **NO-GO** (dead scaffolding) |
| Assume a compiling, tested file is a live path | "How this repo disposes of things" | — |
| Split `ccxt.ts` / wonder why it's huge | Battle 2 | **DEFERRED** |
| Build a board factory / dedupe indicators / unify mock↔demo | Battle 2 (Tasks 2.2 / 2.3) | **DEFERRED** |
| Claim the security review is done | Battle 3 (`REFACTOR_PLAYBOOK.md:218-226`) | **OPEN** (6 lenses) |
| Conclude "no TODOs = no debt" | Battle 4 | **CLOSED** (read docs) |
| Add a `git tag` / ask where v0.6.0 is | Battle 5 | **DEFERRED** |
| Debug why main CI is red | Battle 6 | **CLOSED** (docs.yml/Pages) |

## When NOT to use this skill (use the sibling instead)

- **A bug is happening NOW and you need to triage it** → **`midas-debugging-playbook`** (symptom
  → discriminating-experiment for the 8 recurring live bug classes). This skill is *settled
  history*; that one is *live traps*.
- **You need the procedure to actually re-enable the execution hold** → **`midas-change-control`**
  (it owns the 9-item gate). This skill tells the *story* of the retraction; it owns the *gate*.
- **You need the invariant definitions or how to add a panel** → **`midas-architecture-contract`**.
- **You need the env-var table / what `MIDAS_TRADING_ENABLED` does** → **`midas-config-and-flags`**.
- **You need provenance labeling mechanics** → **`midas-data-honesty-and-provenance`**.
- **You need the six gates / how to add a test** → **`midas-validation-and-qa`**.

## Provenance and maintenance

All facts verified read-only on **2026-07-19** at HEAD `6b0d5ed` (681 commits). Re-verify volatile
facts before relying on them:

| Fact (as of 2026-07-19) | Re-verify with |
|---|---|
| Retraction = `0b83c4f`, 33 files 446+/598−, added `EXECUTION_SAFETY_HOLD.md`, PR #306 (`cc1c2c0`) | `git show 0b83c4f --stat`; `git log --oneline --grep=306` |
| Build-up chain 233-236 + Cycles + per-user gates | `git log -1 --oneline 3361721 a87d37f 10ef633 89aecd4 1b1d4dc c428dfe e084531` |
| 5 retraction root causes | `sed -n '19,32p' docs/EXECUTION_SAFETY_HOLD.md` |
| 503 enforced in `routes/account.ts` via `executionSafetyHoldStatus` | `rg -n "TradingSafetyHold\|executionSafetyHold" apps/server/src/routes/account.ts` |
| `trading.ts` = repair scaffolding (298 loc, pure helpers) | `sed -n '23,30p' apps/server/src/trading.ts`; `wc -l apps/server/src/trading.ts` |
| Line counts: ccxt 964 / registry 48 / routes 25 / shared index 22 / mock 149 | `wc -l apps/server/src/providers/ccxt.ts apps/web/src/commands/registry.ts apps/server/src/routes.ts packages/shared/src/index.ts apps/server/src/providers/mock.ts` |
| Split commits `0038dca 7c8d217 e40b0d3 a7c6f74 2912ff3 eb9ae14` | `git log -1 --oneline <hash>` each |
| ccxt error chokepoint (`safeErrorLabel`, "strip it" @750) | `rg -n "safeErrorLabel\|strip it" apps/server/src/providers/ccxt.ts` |
| Security review incomplete: 6 lenses, spend cap 8/38, lost finding | `sed -n '218,226p' REFACTOR_PLAYBOOK.md` |
| Zero TODO/FIXME/HACK/XXX in source | `rg -c "TODO\|FIXME\|HACK\|XXX" apps packages` (expect no matches) |
| No git tags | `git tag` (expect empty) |
| No `git revert` commits; 1 deletion in history | `git log -i --grep=revert --oneline`; `git log --diff-filter=D --summary \| grep delete` |
| main-CI-red = `docs.yml` + Pages (Task 3.1); tag = Task 3.2 | `sed -n '274,288p' REFACTOR_PLAYBOOK.md` |
| Version 0.5.0 single-sourced; `[Unreleased]` open | `rg -n "MIDAS_VERSION" packages/shared/src/system.ts`; `grep -nE "^## \[" CHANGELOG.md` |

**Maintenance note:** if the execution hold is ever lifted via the `midas-change-control` gate,
Battle 1 moves from NO-GO to CLOSED-and-superseded — update it then, and only then. If `ccxt.ts`
is finally split, move Battle 2's ccxt row to CLOSED with the split commit. "Code wins over docs"
whenever a doc cited here drifts from the repo.
