# Maintenance playbook

How to operate this repository — written so that any contributor (or any
future AI assistant, or just you in six months) can keep Midas healthy
without archaeology.

## The four gates

Every change lands only when all four pass. CI enforces them, but run them
locally first:

```bash
pnpm -r typecheck                    # 1. strict TS across shared/server/web
pnpm --filter @midas/server test     # 2. server suite (Vitest)
cd apps/web && npx vitest run        # 3. web suite (Vitest)
npx vite build                       # 4. production build
node scripts/check-bundle.mjs        # 5. (CI) bundle budget — from repo root
```

Green gates are the definition of "done". A red gate is never merged around.

## Where the invariants live

| Invariant | Enforced by |
|---|---|
| Non-custodial execution hold | `POST /api/orders` and `DELETE /api/orders/:id` return `503` in `routes.ts`; no runtime caller reaches provider write methods |
| Legacy execution repair scaffolding | Pure helpers remain in `apps/server/src/trading.ts` but are not execution authority |
| Per-user account-read isolation | `ProviderPool.userFor` never falls back; see `docs/HOSTED_KEYS_DESIGN.md` |
| Keys encrypted at rest, never returned/logged | `apps/server/src/keys/` — tests assert plaintext never touches disk |
| Data honesty (live/synthetic/unavailable labels) | Provenance fields in `packages/shared`; treat a missing label as a bug |
| Command namespace integrity (~130 commands) | `apps/web/src/commands/registry.test.ts` fails CI on collisions |
| Bundle size | `scripts/check-bundle.mjs` budgets; raise deliberately, in the same PR |

## Reviewing changes safely

- Anything touching `apps/server/src/keys/`, `trading.ts`, or the trading
  section of `routes.ts` is **security-sensitive**: re-verify the reviewer
  checklist in PR [#268](https://github.com/Ayyitskevin/Midas/pull/268)
  (no operator-account fallback, scoped ledgers/idempotency, no secrets in
  logs) before merging.
- New panels follow the registration triad: `commands/registry.ts` +
  `modules/registry.tsx` + `modules/meta.ts` — the registry test catches a
  missed leg.
- Background loops follow one shape: in-flight guard, `unref()`d interval,
  injected clock for tests. Copy an existing one (`alerts/engine`,
  `accountWatch`, `equity`, `digest`).

## Release procedure

1. Move `CHANGELOG.md` `[Unreleased]` under a new version heading.
2. Bump `MIDAS_VERSION` in `packages/shared/src/index.ts` — the single
   definition; it drives `/api/health`, the static demo, and the in-app
   update toast.
3. Add a `RELEASES` entry in `apps/web/src/lib/whatsNew.ts` (headlines, not
   commit logs).
4. Gates green → merge → `git tag -a vX.Y.Z <merge-commit> && git push origin vX.Y.Z`
   → GitHub Release with the changelog section as notes.

## The static demo & docs site

- `.github/workflows/docs.yml` validates the strict MkDocs build and static demo
  on matching pull requests and pushes to `main`.
- Public deployment is intentionally dormant until a maintainer completes the
  one-time setup: Settings → Pages → Source: **GitHub Actions**, then create the
  repository variable `MIDAS_PAGES_ENABLED=true` and manually run the **Docs**
  workflow once. After that, matching pushes to `main` publish the docs at
  `https://ayyitskevin.github.io/Midas/` and the synthetic terminal at `/demo/`.
- Until both settings are present, deployment is skipped and those public URLs
  may return 404. Do not advertise them as live; use `pnpm reviewer:demo` for a
  deterministic local review.
- The demo's data engine lives in `apps/web/src/demo/` and is excluded from
  normal builds by a compile-time flag (`VITE_MIDAS_STATIC_DEMO`); tests in
  `src/demo/demo.test.ts`.

## Operating a hosted box

`docs/HOSTED_BETA.md` is the runbook: env posture, onboarding via the KEYS
panel, `scripts/loadtest.mjs` before inviting anyone.

## Dependency hygiene

Dependabot (`.github/dependabot.yml`) opens weekly PRs; the four gates are
the merge bar. ccxt moves fast — expect its bumps to be routine, but read
its changelog when account reads or order placement change behavior.

## Security

- The operator-facing hardening guide is `docs/SECURITY_HARDENING.md`
  (pre-exposure checklist, env security matrix, trading-gate stack, the
  invariants CI enforces). Keep it current when you add an env var or a gate.
- Repo settings: **secret scanning + push protection ON** (Settings → Code
  security) so a committed key is blocked before it lands; run `pnpm audit`
  alongside Dependabot for CVEs.
- Reviewing anything under `apps/server/src/keys/`, `trading.ts`, `auth/`, or
  the trading section of `routes.ts` is security-sensitive — see the reviewer
  checklist pointer above, and confirm no secret reaches a log line or a
  response body.
