---
name: midas-validation-and-qa
description: >-
  Load when you need to PROVE a Midas change is safe the way this project demands
  — what counts as evidence, the acceptance discipline, and how to add a test.
  Owns the SIX local gates in detail (typecheck; server tests; web tests; web prod
  build; bundle budget; static-demo build) plus the reviewer demo (`pnpm test:reviewer`),
  the web-has-no-DOM test convention (why you can't render a React component in a
  test and what to do instead), the registration-parity test, and the
  "every behavioral fix ships a failing→passing test" rule with copy-paste recipes.
  Triggers: "what tests do I run", "how do I prove this works", "the six gates",
  "acceptance checklist", "before I open the PR", "how do I add a test",
  "server test", "web test", "why is my .test.tsx not running", "can't render a
  component in a test", "no DOM in web tests", "bundle budget", "check-bundle",
  "reviewer demo", "test:reviewer", "registration parity test", "what counts as
  evidence", "is a green suite enough". NOT for whether a change may merge / PR
  lifecycle (midas-change-control), the exact CI step ORDER or recreating the env
  (midas-build-and-env), measurement/introspection tooling (midas-diagnostics-and-tooling).
---

# Midas — validation & QA (proving a change is safe)

**What this skill is for:** turning "I think it works" into evidence Midas accepts.
Use it to pick the right gate, read its output correctly, and add the test your fix
owes. Every command here is copy-pasteable and runs against the deterministic `mock`
provider or the static demo — **never** a real exchange, Anthropic, a webhook, or a
hosted instance.

## The evidence doctrine (the one rule under everything)

> **Generated prose is not evidence.** A confident explanation cannot replace a
> reproducible test, a source-backed data contract, or an artifact from the
> environment that actually matters. (`docs/AI-DEVELOPMENT.md:29-31`)

So for any behavioral change, "evidence" means one of: a **failing→passing test**,
a gate's **actual output pasted back** (counts, exit code, KB numbers), or a
`file:line` you verified. If you can't produce one, you haven't proven it. A green
suite proves the *checked* contracts — it does not certify live-exchange behavior,
a hosted deployment, or anything no test exercises (`docs/REVIEWER-GUIDE.md:60-62`).

## The six local gates + the reviewer demo

These are the checks the maintainer runs locally before review. All are **read-only**
against your working tree (builds write only to git-ignored `dist/` / `dist-demo/`).

| # | Gate | Command | What it PROVES / emits | Gotcha |
|---|------|---------|------------------------|--------|
| 1 | Typecheck | `pnpm -r typecheck` | `tsc --noEmit` in **all 3** packages (shared, server, web); strict mode. Catches registry.tsx↔meta.ts drift (see below). | Runs 3 of 4 "projects" — root has no `typecheck` script and is skipped. |
| 2 | Server tests | `pnpm --filter @midas/server test` | `vitest run` over `apps/server/src/**/*.test.ts`. Route + logic behavior. | Node env; no server started beyond in-process `app.inject`. |
| 3 | Web tests | `cd apps/web && npx vitest run` | `vitest run` over `apps/web/src/**/*.test.ts`. Pure logic + stores only. | **No DOM** — components can't render (see convention below). |
| 4 | Web prod build | `pnpm build` | `pnpm -r build` = server `tsc --noEmit` + web `vite build`. Only web emits real `dist/`. | Shared has no `build`; server `build` emits nothing (2nd typecheck). |
| 5 | Bundle budget | `node scripts/check-bundle.mjs` | gzip KB of built JS vs the perf budget (invariant #5, owned by `midas-architecture-contract`). | **Run from repo ROOT, AFTER gate 4** — else exit 2; full exit-code treatment in `midas-diagnostics-and-tooling`. |
| 6 | Static-demo build | `pnpm --filter @midas/web build:demo` | Builds the server-less in-browser demo into `dist-demo/`. | A type/export only the demo path uses can break here while gate 4 is green. |
| + | Reviewer demo | `pnpm test:reviewer` | `node --test scripts/reviewer_demo.test.mjs` — the launcher's safety unit tests (3). CI front-runs this. | **node:test, not vitest** — don't look for it in a vitest suite. |

`pnpm test` (`pnpm -r test`) is the CI-form combination of gates **2 + 3**. Gate 4's
`pnpm build` is the CI form of the web production build. Run the split forms locally
so each emits its own count/output you can paste as evidence.

> **Cross-ref:** the exact ORDER CI runs these in (and why bundle comes after build)
> is owned by **midas-build-and-env**. That these gates ARE the merge bar — and the
> PR lifecycle around them — is owned by **midas-change-control**. This skill owns
> what each gate *proves* and how to run/read it.

### Certified inventory — verified green 2026-07-19

Re-run to refresh; paste your own numbers as evidence, don't quote these as current.

| Gate | Command | Observed result (2026-07-19) |
|------|---------|------------------------------|
| Typecheck | `pnpm -r typecheck` | PASS — 3 of 4 projects `Done`, 0 errors |
| Server tests | `pnpm --filter @midas/server test` | **45 files / 368 tests** passed |
| Web tests | `cd apps/web && npx vitest run` | **231 files / 1819 tests** passed |
| Combined | `pnpm test` | 276 files / **2187 tests** passed |
| Bundle | `node scripts/check-bundle.mjs` (from root) | main **139.3** KB / total **615.4** KB — within budget (exit 0) |
| Reviewer | `pnpm test:reviewer` | **3 / 3** pass |

(Docs like `REFACTOR_PLAYBOOK.md:100-101` cite stale counts — "262+/1794+". Code wins:
re-run and use the live number.)

### Gate 5 gotcha — the bundle check, in one line

Run `node scripts/check-bundle.mjs` **from the repo root, after gate 4** — else it
exits 2 (it reads `apps/web/dist/assets` relative to cwd, and `dist/` is git-ignored).
Over budget → exit 1. The full exit-code table + the kB-vs-KiB gotcha + how to read
main-vs-total headroom are owned by **`midas-diagnostics-and-tooling`** (Recipe 1, "the
one everyone gets wrong"); the budget thresholds themselves are invariant #5, owned by
**`midas-architecture-contract`**.

## The web-has-no-DOM convention (the most surprising fact)

**The web test suite runs in a plain Node environment with no DOM.** This is
deliberate and load-bearing. Evidence — `apps/web/vitest.config.ts`:

- `environment: 'node'` (line 12) — NOT jsdom, NOT happy-dom.
- `include: ['src/**/*.test.ts']` (line 13) — matches `.test.ts` **only, not `.test.tsx`**.
- `vitest.setup.ts` installs **only** an in-memory `localStorage` shim + a bare
  `window` exposing it (so zustand's `persist` stops warning). No `document`, no
  real `window`, no render surface.
- **No `jsdom` / `happy-dom` / `@testing-library` is a declared dependency** in any
  `package.json` (verified across root/web/server/shared). They appear only
  transitively in `pnpm-lock.yaml`; you cannot `import` them.

**Therefore impossible in a web test (would need a real infra change):**
rendering/mounting React components (`render()`), anything touching `document`,
real `window`, DOM events, layout, or canvas. There are **0** `.test.tsx` files,
and `include` wouldn't run them if you added one.

> **Trap:** a `foo.test.tsx` you write is *silently skipped* — the suite stays green
> and your test never ran. Web test files MUST be `.test.ts` under `src/**`.

**The convention that replaces component testing:**

1. **Extract the pure logic** out of the component into `src/lib/*.ts` (a pure
   function: inputs → outputs, no React, no DOM).
2. **Unit-test that pure function** with fixtures in `src/lib/foo.test.ts`.
3. **Verify the component wiring** — that the component calls the function and
   renders its result — via **typecheck + build + reasoning**, not a render test.

This is why every web test lives under `src/lib/**` and `src/store/**` (stores are
testable *only* because of the localStorage shim), never on a component. To add a
real component test you must first add a DOM environment (jsdom/happy-dom + change
`environment` + broaden `include` to `.tsx`) — a real infra change, not a one-liner,
and out of scope for a normal fix.

> **Cross-ref:** the provenance/honesty-badge logic you extract this way is unit-tested
> as pure lib functions; the labeling checklist and union mechanics are owned by
> **midas-data-honesty-and-provenance**.

## The registration-parity test — two layers

Every panel is registered across a **triad** of files that must stay in lockstep:
`commands/registry.ts` (the command → module map) + `modules/registry.tsx`
(`MODULE_COMPONENTS`, the lazy-loaded component per code) + `modules/meta.ts`
(`ModuleCode` union + `MODULE_META`). Parity is enforced by **two mechanisms** —
know which catches which drift:

**Layer A — typecheck (gate 1).** Both `MODULE_COMPONENTS` (`modules/registry.tsx:19`)
and `MODULE_META` (`modules/meta.ts:250`) are declared `Record<ModuleCode, …>`. A
`ModuleCode` with no component, or a component/meta key that isn't a `ModuleCode`,
is a **compile error**. So registry.tsx ↔ meta.ts drift is caught by `pnpm typecheck`.

**Layer B — the vitest test** `apps/web/src/commands/registry.test.ts` (`describe
'command registry integrity'`). It asserts, at runtime:

| Assertion | Catches |
|-----------|---------|
| Every `COMMANDS[].module` exists in `MODULE_META` | a command pointing at an unregistered module |
| No duplicate token across all `code` + `aliases` | a later alias silently stealing a token (`BY_CODE.set` last-wins — e.g. `VAR` once opened VIDYA) |
| Historically-colliding tokens resolve to pinned owners (`VAR→VAR`, `DRAWDOWN→DD`, `RVOL→UVOL`, `SPREAD→RATIO`, …) | regressions of already-fixed collisions |
| Every command has a non-empty `title` and a `description` > 20 chars | half-registered commands |

So: **typecheck** proves the component/meta halves are exhaustive; **registry.test.ts**
proves the command layer points only at real modules with unique, well-formed tokens.
If you add a panel and only touch two of the three files, one of these two layers fails.

> **Cross-ref:** the step-by-step "how to add a panel/module/command" runbook (which
> three files, in what shape) is owned by **midas-architecture-contract**. This skill
> owns what the parity *test* checks and how to read its failure.

## Every behavioral fix ships a failing→passing test

> **Tests are part of the task.** Every behavioral fix ships with a test that fails
> on the old code and passes on the new. Pure logic goes in a pure function with a
> fixture test (the house pattern). If you cannot write a failing test for a "bug",
> question whether it is a bug — report instead of guessing.
> (`REFACTOR_PLAYBOOK.md:111-114`; the evidence bar is `docs/AI-DEVELOPMENT.md:17-31`.)

**The discipline:** write the test FIRST, watch it FAIL on the current code (that
proves the test actually exercises the bug), make the fix, watch it PASS. Paste both
states — the red and the green — as your evidence.

> **Cross-ref:** that this rule is a merge requirement (not optional) is owned by
> **midas-change-control**; this skill owns the how-to.

### Running ONE test file — the canonical focused form

While iterating, run just the file you touched. **The invocation matters** — one
common form silently runs the whole suite:

```bash
# server — canonical: `exec` runs vitest directly; the pattern is a filename filter
pnpm --filter @midas/server exec vitest run <pattern>     # e.g. fundingDispersion → 1 file
# web — the equivalent (run from the package dir)
cd apps/web && npx vitest run <pattern>
```

> **Do NOT use `pnpm --filter @midas/server test -- <pattern>`.** The `--` form does
> **not** forward the filter — it silently runs the **whole** 45-file suite. Verified
> 2026-07-19: `… test -- fundingDispersion` ran all 45 files / 368 tests, while
> `… exec vitest run fundingDispersion` ran 1 file / 8 tests.

This is the canonical focused form; the other skills (diagnostics, proof, campaign,
debugging) reference it. Watch mode, `-t <title>` single-test, and the deeper
introspection variants are owned by **`midas-diagnostics-and-tooling`**.

### Recipe A — web pure-logic test (the house pattern)

Model on `apps/web/src/lib/disparity.test.ts` (hand-computed fixtures).

```ts
// src/lib/foo.ts — pure: inputs → outputs, no React/DOM
export function foo(xs: number[], period: number): number | null { /* ... */ }
```
```ts
// src/lib/foo.test.ts   (MUST be .test.ts, under src/**)
import { describe, it, expect } from 'vitest';
import { foo } from './foo';

describe('foo', () => {
  // State the hand-computed expected value in a comment, then assert it.
  it('matches the hand-computed example', () => {
    expect(foo([8, 8, 8, 12], 3)).toBeCloseTo(20, 9);
  });
  it('returns null on too little history', () => {
    expect(foo([1], 3)).toBeNull();
  });
});
```
Run just this file while iterating: `cd apps/web && npx vitest run src/lib/foo.test.ts`.

### Recipe B — server logic test (incl. shared math)

Import the function directly (from its module, or from `@midas/shared` for compute
helpers) and fixture-test it. Model: `apps/server/src/fundingDispersion.test.ts`
(`import { computeFundingDispersion } from '@midas/shared'`).

```ts
import { describe, it, expect } from 'vitest';
import { computeFundingDispersion, type VenueDerivatives } from '@midas/shared';
// build a small fixture, assert the exact output. Same source both tiers run.
```
Run just this file: `pnpm --filter @midas/server exec vitest run fundingDispersion`
(the canonical focused form above).

### Recipe C — server route/integration test

For behavior at the HTTP boundary, build the app on the **mock** provider and use
Fastify's in-process `app.inject` — no network, no exchange. Model:
`apps/server/src/app.test.ts`.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app';
import { createProvider } from './providers';

let app;
beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  app = await buildApp(createProvider('mock'));   // mock only — never a real exchange
  await app.ready();
});
afterAll(async () => { await app.close(); });

it('quote returns a numeric price', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/quote/BTC%2FUSDT' });
  expect(res.statusCode).toBe(200);
  expect(typeof res.json().price).toBe('number');
});
```

**Safety-boundary regression test (the model to copy for any invariant):**
`apps/server/src/keys/userTrading.test.ts` proves `POST /api/orders` and
`DELETE /api/orders/:id` return **503 `TradingSafetyHold`** — for authed users,
the operator, AND the no-auth app. When you touch an invariant, add/extend a test
in this shape so the boundary can't silently regress.

## Pre-PR acceptance checklist (run, then paste outputs)

```bash
# from repo ROOT
pnpm -r typecheck                              # gate 1
pnpm --filter @midas/server test               # gate 2  (paste the N tests count)
cd apps/web && npx vitest run && cd ..         # gate 3  (paste the N tests count)
pnpm build                                     # gate 4  (web dist emitted)
node scripts/check-bundle.mjs                  # gate 5  (from ROOT, after build; paste KB + exit 0)
pnpm --filter @midas/web build:demo            # gate 6  (static demo builds)
pnpm test:reviewer                             # +       (3/3)
```

- [ ] All seven green; counts/KB **pasted**, not asserted from memory.
- [ ] The behavioral change has a **failing→passing** test (red state shown too).
- [ ] For a web change: logic lives in `src/lib/*.ts` with a `.test.ts`; component
      wiring justified by typecheck + build (no render test attempted).
- [ ] Added a panel? typecheck + `registry.test.ts` both green (all 3 triad files).
- [ ] Anything you could NOT run is stated with the reason (`AGENTS.md:46-47`).
- [ ] No secret, real credential, or live provider response entered a test/fixture.

## When NOT to use this skill

| You need… | Use instead |
|-----------|-------------|
| Whether a change is ALLOWED to merge; PR lifecycle; classification; the merge bar as a rule | **midas-change-control** |
| The exact CI step ORDER; recreating the env; pnpm/node pins; no-lint; tsx-no-compile | **midas-build-and-env** |
| Measurement/introspection tooling; focused-vitest deep dive; quota/stream introspection; runnable scripts | **midas-diagnostics-and-tooling** |
| The provenance union mechanics / labeling checklist for a new surface | **midas-data-honesty-and-provenance** |
| The step-by-step add-a-panel triad runbook; the 6 invariants | **midas-architecture-contract** |
| Env var names / defaults / how to add a flag | **midas-config-and-flags** |

## Provenance and maintenance (all facts dated 2026-07-19)

| Fact | Re-verify |
|------|-----------|
| Six gates + reviewer demo, as commands | `sed -n '35,43p' AGENTS.md`; `sed -n '24,40p' .github/workflows/ci.yml` |
| Server = 45 files / 368 tests | `pnpm --filter @midas/server test 2>&1 | tail -3` |
| Web = 231 files / 1819 tests | `cd apps/web && npx vitest run 2>&1 | tail -3` |
| Combined = 276 files / 2187 tests | `pnpm test 2>&1 | tail -4` |
| Bundle main 139.3 / total 615.4 KB (observed measurement); budget = invariant #5, owned by `midas-architecture-contract` | `node scripts/check-bundle.mjs` (from root, after `pnpm build`) |
| `test:reviewer` = 3 tests via node:test | `pnpm test:reviewer` |
| Web tests: `environment:'node'`, `include:['src/**/*.test.ts']` | `sed -n '11,15p' apps/web/vitest.config.ts` |
| No jsdom/happy-dom/@testing-library as a dep | `grep -l "jsdom\|happy-dom\|testing-library" apps/*/package.json packages/*/package.json` (expect none) |
| Setup shims only localStorage + bare window | `cat apps/web/vitest.setup.ts` |
| Parity test assertions | `cat apps/web/src/commands/registry.test.ts` |
| Typecheck enforces triad exhaustiveness | `grep -n "Record<ModuleCode" apps/web/src/modules/registry.tsx apps/web/src/modules/meta.ts` |
| Bundle budgets + run-dir | `sed -n '17,24p' scripts/check-bundle.mjs` |
| Failing→passing rule | `sed -n '111,114p' REFACTOR_PLAYBOOK.md`; `sed -n '17,31p' docs/AI-DEVELOPMENT.md` |
| Reviewer demo is credential-free (strips secrets) | `sed -n '22,75p' scripts/reviewer_demo.mjs` |

If any count/threshold drifts, **code wins over docs** — re-run the command and update
the stamp. Wrong runbooks are worse than none.
