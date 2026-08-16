# Dependency migration plan

Classification of open Dependabot PRs and the coherent upgrade waves
implemented in-repo. Majors are **not** merged together just to clear the queue.

## Wave 2 (2026-08-15) — npm patch/minor + first-party Actions majors

Second wave. Group A refreshed within current majors, and the Actions majors
that CI can actually prove on the pull request itself.

| Change | From → To | Evidence |
| --- | --- | --- |
| `ccxt` | 4.5.67 → 4.5.73 | server suite + `depWave.regression.test.ts` |
| `fastify` | 5.10.0 → 5.12.0 | same; real `buildApp` registration path |
| `tsx` | 4.23.1 → 4.23.12 | dev/start runner; typecheck + build |
| `ws` | 8.21.1 → 8.21.3 | websocket frame-cap regression |
| `postcss` | 8.5.20 → 8.5.26 | web build + bundle budget |
| `react-grid-layout` | 1.5.3 → **1.5.4** | see supply-chain note below |
| `actions/checkout` | v4 → **v7** | exercised by CI on the PR |
| `actions/setup-node` | v4 → **v7** | exercised by CI on the PR (Node 22 + pnpm cache) |
| `actions/setup-python` | v5 → **v7** | exercised by the Docs job on the PR |

### Supply-chain note: `react-grid-layout` 1.5.3

1.5.0–1.5.3 shipped files that were never in the upstream repository: an
`ip_fetcher` executable, its C source, and (in 1.5.3) a 374 KB `yarn-error.log`
containing a maintainer's local paths. Upstream deprecated 1.5.3 for exactly
this and published 1.5.4, byte-identical apart from removing them.

Inspected before upgrading, and it was **inert** in this repo: the C source is
curl's own generated sample fetching `https://ifconfig.me`, the compiled binary
is Mach-O arm64 (it cannot execute on the Linux CI or a Linux host), it embeds
no host other than the one in the source, nothing in the package references it,
and the package declares no install/postinstall hook. An accidental publish, not
an attack. The floor moved to `^1.5.4` regardless: an unreferenced executable in
`node_modules` is not something to keep on the grounds that it happens to be
harmless here.

### Why `actions/checkout` v7 is safe for this repo

v7's breaking change blocks checking out a fork PR under `pull_request_target`
and `workflow_run` ([GitHub changelog][checkout-v7]). Midas triggers on `push`,
`pull_request`, `workflow_dispatch`, `issue_comment` and
`pull_request_review_comment` only — **neither affected trigger appears in any
workflow** — so the change is inapplicable rather than merely tolerated. Re-check
this if a workflow ever adopts `pull_request_target`.

[checkout-v7]: https://github.blog/changelog/2026-06-18-safer-pull_request_target-defaults-for-github-actions-checkout/

### Deliberately excluded from this wave

| Deferred | Why |
| --- | --- |
| `actions/upload-pages-artifact` 3 → 5, `actions/deploy-pages` 4 → 5 | Both steps are gated on `github.ref == 'refs/heads/main'`, so a pull request **cannot** exercise them. Bumping them here would land two unverifiable majors on the strength of a green CI run that never ran them. They need their own PR. Confirmed dormant afterwards: on the post-merge `main` run for `de461fd`, `Upload Pages artifact` and the `deploy` job are both `skipped` because `vars.MIDAS_PAGES_ENABLED` is not `'true'`, so these actions do not run on `main` either. Bump them **together** (the artifact format must stay compatible with the consumer) at the moment Pages is enabled, so the first real deploy exercises both. Dependabot PRs #272/#273 were closed with this reasoning. |
| `@fastify/cors` 10 → 11 | Dedicated server PR — it moves the CORS boundary that the keyed-account guard's fail-closed posture depends on. |
| `vite` 5 → 8 + `@vitejs/plugin-react` 4 → 6 | Toolchain majors; one controlled PR with build, demo build and bundle budget. |

## Wave 1 (2026-07-20)

Classification as of 2026-07-20; the wave implemented on
`grok/midas-release-governance`.

## Classification of open PRs

### A — Safe patch / minor (npm group) — **this wave**

| PR | Packages | From → To (resolved) | Risk |
| --- | --- | --- | --- |
| **#319** | `@fastify/websocket`, `ccxt`, `fastify`, `tsx`, `ws`, `autoprefixer`, `postcss` | patch/minor within current major | Low — semver-compatible; exercise server suite + web build |

Implemented in-repo as one lockfile-coherent wave (does not close the GitHub PR).

### B — CI / Actions infrastructure majors — **deferred**

| PR | Change | Blocker / sequencing |
| --- | --- | --- |
| #274 | `actions/checkout` 4 → 7 | Major; OpenCode already uses checkout@v6. Validate all workflows + pin strategy together. Prefer after npm wave is green. |
| #270 | `actions/setup-node` 4 → 7 | Major; confirm Node 22 cache + pnpm still work. |
| #271 | `actions/setup-python` 5 → 7 | Docs job only; pair with checkout/setup-node wave. |
| #272 | `actions/deploy-pages` 4 → 5 | Pages deploy; test on a docs-only PR. |
| #273 | `actions/upload-pages-artifact` 3 → 5 | Must stay compatible with deploy-pages major. |

**Recommended sequencing:** one dedicated “Actions majors” PR after this wave:
checkout + setup-node + setup-python first on CI; then Pages upload/deploy on a
docs path change. Prefer full SHAs for third-party; first-party majors via
Dependabot is acceptable once CI is green.

### C — Framework / toolchain majors — **deferred**

| PR | Change | Blockers | Sequencing |
| --- | --- | --- | --- |
| #280 | `vite` 5 → 8 | Ecosystem break (config, env, dep optimizer); must move with plugin-react | After #283 plan; migrate Vite 5→6 then 6→8 or follow Vite migration guides in one controlled PR with `build` + `build:demo` + bundle budget |
| #283 | `@vitejs/plugin-react` 4 → 6 | Peer dependency on Vite major | Same PR as Vite major |
| #281 | `lightweight-charts` 4 → 5 | Chart API v5 migration (series/types); visual + unit coverage for chart modules | **Resolved** — landed separately; `apps/web` is on `^5.2.0`. Classification below is the 2026-07-20 snapshot, not current state. |
| #282 | `@fastify/cors` 10 → 11 | Major; verify CORS origin pinning + preflight still match `SECURITY_HARDENING` matrix | Dedicated server PR; re-run `app.test.ts` / hardening tests |

**Do not** land Vite 8 + plugin-react 6 + lightweight-charts 5 + `@fastify/cors` 11
in one PR.

## This wave (implemented)

Packages updated within current majors (lockfile + resolved installs):

| Package | Before | After |
| --- | --- | --- |
| `@fastify/websocket` | 11.2.0 | **11.3.0** |
| `ccxt` | 4.5.59 | **4.5.67** |
| `fastify` | 5.8.5 | **5.10.0** |
| `tsx` | 4.22.4 | **4.23.1** |
| `ws` | 8.21.0 | **8.21.1** |
| `autoprefixer` | 10.5.1 | **10.5.4** |
| `postcss` | 8.5.15 | **8.5.20** |

Bundle budget (gzip) before and after this wave: **Main 139.5 KB / Total 617.6 KB**
(unchanged — wave is server + CSS tooling, not the chart bundle).

Regression: `apps/server/src/depWave.regression.test.ts` (real `buildApp`:
health/CORS/websocket maxPayload, synthetic on-chain provenance, TradingSafetyHold).

### Verification required

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm test
pnpm build
node scripts/check-bundle.mjs
pnpm test:reviewer
node scripts/check-release-governance.mjs
```

### Rollback

```bash
git revert <dep-wave-commit>
# or restore pnpm-lock.yaml + package.json from main and reinstall
pnpm install --frozen-lockfile
```

## Out of scope

- Closing or merging Dependabot PRs on GitHub from this work
- Production exchange config changes
- Re-enabling order execution
