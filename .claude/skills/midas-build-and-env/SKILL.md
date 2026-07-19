---
name: midas-build-and-env
description: >-
  Recreate the Midas dev environment from a fresh clone and reproduce the CI merge gate
  exactly, in the right order. Load this when: setting up from scratch (Node/pnpm versions,
  `pnpm install --frozen-lockfile`, corepack); a build/install/CI step fails or you want to
  reproduce CI locally before opening a PR; you hit `check-bundle` exit 2, a frozen-lockfile
  mismatch, or a missing `apps/web/dist/`; you are unsure of the gate ORDER (build + bundle
  run BEFORE tests); or you are about to type `pnpm lint` (there is NO lint gate), run
  `build` in `@midas/shared` (raw TS, no build script), or expect `server build` to emit
  files (it is `tsc --noEmit`). Owns: from-scratch setup + the exact `.github/workflows/ci.yml`
  gate order + the build/env traps. For what the gates MEAN and adding tests see
  midas-validation-and-qa; for env vars see midas-config-and-flags; for docker/deploy see
  midas-run-and-operate.
---

# Midas — build & environment (from scratch, as CI runs it)

Recreate a working environment from a fresh clone, then reproduce the exact CI merge gate.
This skill is about the **mechanics**: versions, commands, order, and the traps that waste
hours. **CI config (`.github/workflows/ci.yml`) is ground truth; the README is rumor.** When
docs and code disagree, code wins.

Repo root is `/home/user/Midas`. All commands below assume you start there.

## Load this skill when you see

- "set up the repo", "fresh clone", "which Node / pnpm version", "install fails"
- "reproduce CI locally", "run the gates", "what order does CI run", "why did CI fail on build"
- `check-bundle` prints `... not found` / exits 2; `pnpm install` complains about the lockfile
- Someone reaches for `pnpm lint`, `pnpm build` inside `packages/shared`, or expects a `dist/`
  from the server build

---

## 1. From-scratch setup (do exactly this)

Midas is a **pnpm monorepo** (`pnpm-workspace.yaml` globs `apps/*` + `packages/*` →
`@midas/shared`, `@midas/server`, `@midas/web`). There is **no compile step in prod** — the
server runs raw TypeScript under `tsx`, and `@midas/shared` is consumed as raw `.ts` source.

| Step | Command | Why / trap |
|---|---|---|
| 1. Node **22** | `nvm use` (reads `.nvmrc` = `22`) or install Node 22 | CI pins node 22 (`ci.yml:21`). `package.json:9` `engines.node` says `>=20`, but **22 is the tested pin** — use 22. |
| 2. pnpm **10.33.0** | `corepack enable` (then pnpm resolves to the pinned version automatically) | `package.json:11` `"packageManager": "pnpm@10.33.0"`. Corepack reads that field. Do **not** hand-install a different pnpm major — the lockfile format is pnpm-10. |
| 3. Install | `pnpm install --frozen-lockfile` | `--frozen-lockfile` = install exactly `pnpm-lock.yaml`, fail if `package.json` drifted from it. **This is the CI command** — reproduce it, don't use a bare `pnpm install` when checking CI parity. |

**esbuild build-approval trap.** pnpm 10 does **not** run dependencies' install/build scripts
by default. `package.json:27-29` allow-lists exactly one: `"onlyBuiltDependencies": ["esbuild"]`
(esbuild@0.21.5, used by Vite/Vitest, needs its native binary). If you ever see Vite/Vitest fail
with a missing esbuild binary after a fresh install, that allow-list (or the post-install build)
is why — do not delete it.

**No env vars needed to start.** Defaults are safe: the data provider is `mock`, auth is off. A
fresh install runs with zero configuration. (Env var table + boot-time traps like
`MIDAS_KEYS_KMS_SECRET` → **midas-config-and-flags**.)

Dev servers (optional smoke test that your env runs — for real operation/docker see
**midas-run-and-operate**):

```bash
pnpm dev          # pnpm -r --parallel dev → tsx watch (server) + vite (web)
pnpm dev:web      # web only  (vite)
pnpm dev:server   # server only (tsx watch src/index.ts)
```

---

## 2. Reproduce the CI merge gate — the EXACT order

One CI job ("Typecheck & build", `ci.yml:9-11`), Node 22, pnpm 10.33.0, on **every push to
`main` and every pull request** (`ci.yml:3-6`, no branch filter). Steps, in order
(`ci.yml:24-40`):

| # | CI step (`ci.yml`) | Command | Resolves to |
|---|---|---|---|
| 1 | Install (L25) | `pnpm install --frozen-lockfile` | — |
| 2 | Reviewer launcher tests (L28) | `pnpm test:reviewer` | `node --test scripts/reviewer_demo.test.mjs` (`package.json:20`) |
| 3 | Typecheck (L31) | `pnpm typecheck` | `pnpm -r typecheck` → `tsc --noEmit` in all **3** packages |
| 4 | Build (L34) | `pnpm build` | `pnpm -r build` → server `tsc --noEmit`, web `vite build` |
| 5 | Bundle budget (L37) | `node scripts/check-bundle.mjs` | reads `apps/web/dist/assets`; **must come after step 4** |
| 6 | Test (L40) | `pnpm test` | `pnpm -r test` → server `vitest run` + web `vitest run` |

> **The single most surprising ordering fact: build (4) and bundle (5) run BEFORE the test
> suite (6).** A broken build fails CI before a single unit test runs. And `test:reviewer` (2)
> runs **first of all**, before typecheck. Do not assume "tests first".

**Copy-paste block to run the whole CI gate locally, in order:**

```bash
cd /home/user/Midas
corepack enable                 # ensure pnpm 10.33.0 from the packageManager field
pnpm install --frozen-lockfile  # gate 1
pnpm test:reviewer              # gate 2  — reviewer launcher (runs FIRST, before typecheck)
pnpm typecheck                  # gate 3  — tsc --noEmit × shared, server, web
pnpm build                      # gate 4  — server tsc --noEmit; web vite build → apps/web/dist
node scripts/check-bundle.mjs   # gate 5  — MUST be repo root, AFTER the build
pnpm test                       # gate 6  — server + web vitest (shared has no tests)
```

If all six exit 0, you have reproduced the CI merge gate. (What each gate *proves*, the
evidence bar, and how to add tests → **midas-validation-and-qa**.)

**`AGENTS.md:35-43` lists a local gate sequence too** — it adds `pnpm --filter @midas/web
build:demo` and orders things slightly differently. When they disagree, **`ci.yml` is the
authority** for the merge gate; `AGENTS.md` is the contributor checklist (it front-loads the
demo build, which CI does not run — see §5).

---

## 3. What each gate actually does (structural facts)

- **`pnpm test:reviewer`** — runs `node --test` on `scripts/reviewer_demo.test.mjs`, which tests
  the reviewer launcher (`scripts/reviewer_demo.mjs`) that serves the static demo. Deterministic,
  credential-free (the test asserts secrets like `ANTHROPIC_API_KEY` are stripped from the demo
  env). 3 tests. This is a fast, dependency-light gate — that is why CI runs it first.
- **`pnpm typecheck`** → `pnpm -r typecheck` → `tsc --noEmit` in **all three** packages. Prints
  `Scope: 3 of 4 workspace projects` — the 4th "project" is the root `package.json`, which has no
  `typecheck` script so `pnpm -r` skips it. There are **no TS project references / composite
  build**; each package typechecks itself independently.
- **`pnpm build`** → `pnpm -r build`. Runs in **only two** packages:
  - `@midas/server` `build` = **`tsc --noEmit`** (`apps/server/package.json:11`) — a *second
    typecheck*. It **emits nothing**. Do not look for a server `dist/`.
  - `@midas/web` `build` = **`vite build`** — the **only** command that emits real output, into
    `apps/web/dist/`.
  - `@midas/shared` has **no `build` script**, so `pnpm -r build` silently skips it.
- **`node scripts/check-bundle.mjs`** — gzips every `*.js` in `apps/web/dist/assets` and fails if
  the entry chunk (`index-*`) or the total exceeds the budget constants (`check-bundle.mjs:17-18`).
  Those thresholds are **perf-budget invariant #5**, owned by **midas-architecture-contract** (don't
  restate the numbers — read them live); measuring/raising the budget is
  **midas-diagnostics-and-tooling**. This skill owns only its **run mechanics** (see traps below).
  Exit codes: `0` within budget, `1` over budget, `2` if the dist dir is missing (wrong dir or no build).
- **`pnpm test`** → `pnpm -r test` → `vitest run` in server and web (both `environment: 'node'`).
  `@midas/shared` has **no `test` script** and is skipped by `pnpm -r test`. Web tests run with
  **no DOM** — that convention and how to add tests belong to **midas-validation-and-qa**; here
  just know `pnpm test` covers server + web, never shared.

---

## 4. Traps that waste hours (read before you debug a build)

| Trap | Reality | Evidence |
|---|---|---|
| **`pnpm lint`** | **No lint gate exists anywhere.** No `lint` script in any `package.json`; no eslint/prettier config file in the repo. `pnpm lint` just errors. Never add it to a runbook or "CI failed on lint" story. | grep: 0 `"lint"` scripts, 0 `.eslintrc*`/`eslint.config.*`/`.prettierrc*` files |
| **`@midas/shared` build/test** | Shared is **raw TS**, consumed via tsconfig `paths` + Vite/Vitest aliases straight into `packages/shared/src/index.ts`. It has **only** a `typecheck` script — **no `build`, no `test`.** `pnpm -r build`/`pnpm -r test` skip it; only `pnpm -r typecheck` covers it. Editing shared is picked up instantly by all three packages (no rebuild). | `packages/shared/package.json:12-14`; `main`/`types`/`exports` all `./src/index.ts` |
| **Expecting a server `dist/`** | `server build` is `tsc --noEmit` — a typecheck, not a compile. Server ships as raw TS under `tsx`. Only `apps/web` produces build output. | `apps/server/package.json:11` |
| **`check-bundle` needs repo root + a prior build** | It reads `join(process.cwd(), 'apps/web/dist/assets')`, and `apps/web/dist` is **gitignored** (`.gitignore:6` `dist/`) so a fresh checkout has none. Run `pnpm build` first, from **repo root**, or it **exits 2**. In CI the step order (build → bundle) guarantees it. Full exit-code treatment: **midas-diagnostics-and-tooling** (Recipe 1). | `check-bundle.mjs:20-24`; `git ls-files apps/web/dist` → 0 tracked |
| **Bare `pnpm install` for CI parity** | CI uses `--frozen-lockfile`. A bare `pnpm install` may silently update the lockfile and hide a drift that CI would reject. Use `--frozen-lockfile` when reproducing CI. | `ci.yml:25` |
| **Wrong pnpm/Node** | Lockfile is pnpm-10 format; `corepack enable` pins 10.33.0 from `packageManager`. Node 22 is the tested pin despite `engines >=20`. | `package.json:11`; `.nvmrc`; `ci.yml:21` |

---

## 5. There are TWO workflows — only one is the code gate

- **`ci.yml`** ("CI") — the **merge gate** (§2). Runs on every push to `main` and every PR.
- **`docs.yml`** ("Docs") — GitHub Pages, **not a code gate**. Triggers only on push to `main`
  touching `docs/**`, `mkdocs.yml`, `docs.yml`, `apps/web/**`, or `packages/shared/**`
  (`docs.yml:3-11`). It runs `mkdocs build --strict` (fails on any broken doc link, `docs.yml:32`)
  and **`pnpm --filter @midas/web build:demo`** (`docs.yml:43`) — the static, server-less
  in-browser demo → `apps/web/dist-demo/` (also gitignored, `apps/web/.gitignore`).

**Implication:** `build:demo` and `mkdocs` are **not in the CI merge gate**. A change that breaks
the static demo build or a docs link is caught by **Docs**, not **CI**, and only when the trigger
paths change. Contributors are still expected to run `build:demo` locally (`AGENTS.md:41`) for
web changes.

---

## 6. Per-package script reference

Root scripts (`package.json:12-23`) wrap packages with pnpm recursion/filters:

| Package | dev | build | typecheck | test |
|---|---|---|---|---|
| **root** (`midas`) | `pnpm -r --parallel dev` | `pnpm -r build` | `pnpm -r typecheck` | `pnpm -r test` |
| **@midas/shared** | — | — (none) | `tsc --noEmit` | — (none) |
| **@midas/server** | `tsx watch src/index.ts` | `tsc --noEmit` (no emit) | `tsc --noEmit` | `vitest run` |
| **@midas/web** | `vite` | `vite build` | `tsc --noEmit` | `vitest run` |

Other root scripts: `start` = `pnpm --filter @midas/server start` (`tsx src/index.ts`);
`test:reviewer` = `node --test scripts/reviewer_demo.test.mjs`; `reviewer:demo` =
`node scripts/reviewer_demo.mjs`; `clean` = remove `dist`/`node_modules`/`.vite`.
Web-only extra: `build:demo` = `VITE_MIDAS_STATIC_DEMO=true vite build --base=/Midas/demo/
--outDir=dist-demo` (`apps/web/package.json:13`).

---

## 7. tsconfig wiring (how typecheck resolves)

- **`tsconfig.base.json`** (root): `strict: true`, `target ES2022`, `module ESNext`,
  `moduleResolution "Bundler"`, plus `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `noImplicitOverride`, `isolatedModules`, `verbatimModuleSyntax`,
  `skipLibCheck`. Every package `extends` this.
- **shared** — minimal: `rootDir: src`, `noEmit`.
- **server** — adds `types: ["node"]`, `lib ["ES2022"]`, `noEmit`.
- **web** — adds `lib ["ES2022","DOM","DOM.Iterable"]`, `jsx "react-jsx"`,
  `allowImportingTsExtensions`, `paths { "@midas/shared": [".../shared/src/index.ts"], "@/*":
  ["src/*"] }`, `noEmit`. **Note:** web's `lib` includes `DOM` for the app Vite compiles — this
  does **not** give its *tests* a DOM (tests run `environment: 'node'`; see
  midas-validation-and-qa).
- **No project references / composite.** `typecheck` is independent `tsc --noEmit` per package;
  there is no cross-package build graph. Shared resolves as raw source through tsconfig `paths`
  and Vite/Vitest aliases.

---

## 8. Confirm your env is healthy (fast, read-only)

```bash
node --version                                   # expect v22.x
pnpm --version                                   # expect 10.33.0
pnpm -r typecheck 2>&1 | tail -3                 # expect "Scope: 3 of 4", all "Done", no errors
pnpm test:reviewer 2>&1 | tail -4                # expect "# pass 3 / # fail 0"
node scripts/check-bundle.mjs 2>&1 | tail -2     # from ROOT, after a build → "Bundle within budget."
```

If typecheck errors on a fresh clone, suspect Node/pnpm version drift first, then a stale
`node_modules` (re-run `pnpm install --frozen-lockfile`). If `check-bundle` prints `... not
found`, you are in the wrong directory or have not built (§4).

---

## When NOT to use this skill

| You need… | Use instead |
|---|---|
| What a gate *proves*, the evidence bar, how to add tests, the web-no-DOM convention | **midas-validation-and-qa** |
| The env var table, defaults, boot-time flag traps, how to add a flag | **midas-config-and-flags** |
| docker compose, nginx/server topology, the `midas-data` volume, deploy.sh | **midas-run-and-operate** |
| How to MEASURE/interpret the bundle, focused vitest, quota/stream introspection | **midas-diagnostics-and-tooling** |
| The perf budget as an invariant, the architecture seams | **midas-architecture-contract** |
| How a change is classified/gated/reviewed; branch/PR discipline | **midas-change-control** |

This skill only recreates the environment and reproduces the build/CI gates mechanically. Any
behavior change still goes through **midas-change-control** (branch from `main`, one concern =
one small draft PR, six gates + reviewer demo green).

---

## Provenance and maintenance

All facts verified against the repo on **2026-07-19** at repo root `/home/user/Midas`. Volatile
facts are date-stamped; re-verify with the paired command.

| Fact (2026-07-19) | Re-verify |
|---|---|
| Node pin **22** (tested), `engines >=20` | `cat .nvmrc; sed -n '8,10p' package.json; grep -n node-version .github/workflows/ci.yml` |
| pnpm **10.33.0** via `packageManager` | `sed -n '11p' package.json; pnpm --version` |
| CI gate order: install → test:reviewer → typecheck → build → check-bundle → test | `sed -n '24,40p' .github/workflows/ci.yml` |
| **No lint** gate (0 scripts, 0 configs) | `grep -rn '"lint"' --include=package.json . \| grep -v node_modules; ls .eslintrc* eslint.config.* .prettierrc* 2>/dev/null` |
| shared = typecheck-only (no build/test) | `cat packages/shared/package.json` |
| server build = `tsc --noEmit` | `grep -n '"build"' apps/server/package.json` |
| web build = `vite build` (only emitter) | `grep -n '"build"' apps/web/package.json` |
| check-bundle reads `cwd/apps/web/dist/assets`; budget constants at :17-18 (invariant #5, owned by architecture-contract); exit 2 missing / 1 over | `sed -n '17,24p;45,52p' scripts/check-bundle.mjs` |
| `dist/` gitignored, 0 tracked | `grep -n dist/ .gitignore; git ls-files apps/web/dist \| wc -l` |
| esbuild is the only `onlyBuiltDependencies` | `grep -n onlyBuiltDependencies package.json` |
| Two workflows; `build:demo`+`mkdocs` only in Docs | `ls .github/workflows/; grep -n 'build:demo\|mkdocs' .github/workflows/docs.yml` |
| Observed green: typecheck 3/4 · reviewer 3/3 · bundle main 139.3 / total 615.4 KB | run §8 checks (bundle needs a prior `pnpm build`) |

Owners of facts this skill deliberately does not restate: perf budget invariant →
midas-architecture-contract; gate meaning + how-to-add-tests + web-no-DOM → midas-validation-and-qa;
env var table → midas-config-and-flags; docker/deploy → midas-run-and-operate. If any command
above changes, update this skill and its owner in lockstep.
