# Dependency migration plan

Classification of open Dependabot PRs (as of **2026-07-20**) and the single
coherent upgrade wave implemented on `grok/midas-release-governance`. Majors are
**not** merged together just to clear the queue.

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
| #281 | `lightweight-charts` 4 → 5 | Chart API v5 migration (series/types); visual + unit coverage for chart modules | Dedicated PR after Vite wave or independent if chart imports isolated — audit `apps/web` chart usage first |
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
