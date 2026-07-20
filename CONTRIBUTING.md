# Contributing to Midas

Thanks for your interest in Midas — a self-hosted, Bloomberg-style crypto market
terminal. Contributions of all sizes are welcome: new indicator boards, data
providers, bug fixes, docs, and DX improvements.

By contributing you agree that your contributions are licensed under the
project's [AGPL-3.0-only license](./LICENSE).

## Quick start

Requirements: **Node ≥ 20** and **pnpm 10** (`corepack enable` will provide it).

```bash
pnpm install --frozen-lockfile
pnpm dev          # web on :5173, API on :4000 — runs on synthetic data, zero config
```

The default `mock` data provider is fully synthetic and deterministic, so the
terminal works offline with no API keys. For live crypto data:

```bash
MIDAS_DATA_PROVIDER=ccxt MIDAS_CCXT_EXCHANGE=binance pnpm dev
```

## Repository layout

```
packages/shared   @midas/shared — the data contract (types) shared by both apps
apps/server       Fastify API + pluggable DataProvider implementations (mock/ccxt/yahoo)
apps/web          React/Vite terminal UI (Zustand stores, Tailwind, command bar)
```

For how the pieces fit together — the data contract, the provider seam, the
command/panel/module system, and the data-honesty model — see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## The gates (run before every PR)

CI runs these on every PR; please run them locally first:

```bash
pnpm -r typecheck                      # all three packages
pnpm --filter @midas/server test       # server (vitest)
cd apps/web && npx vitest run          # web (vitest)
cd apps/web && npx vite build          # production build
```

Keep the suite green and add tests for new pure logic. We favor small,
single-concern PRs.

## Adding an indicator/analytics board (the common case)

Most boards follow one repeatable pattern — copy the nearest existing board and
adapt it:

1. `apps/web/src/lib/<name>.ts` — the pure calculation, plus `<name>.test.ts`.
2. `apps/web/src/modules/<Name>Module.tsx` — the panel that renders it.
3. Register the module code in `apps/web/src/modules/meta.ts` (the `ModuleCode`
   union **and** the `PANEL` metadata).
4. Lazy-load it in `apps/web/src/modules/registry.tsx`.
5. Add a command entry in `apps/web/src/commands/registry.ts`.
6. Add a row to the command table in `README.md`.

Adding a data field end-to-end touches `packages/shared` (the type), all three
providers in `apps/server/src/providers/`, a route in `apps/server/src/routes.ts`,
and the web `api` client — see the `DEX` / on-chain work for a worked example.

## Data honesty (please read)

Midas's core principle is that the UI must **never present synthetic, delayed, or
unavailable data as if it were live**. Mock data is labeled synthetic; sources
that can't serve a feature return an honest `unavailable` rather than guessing.
If your change surfaces data, label its provenance. See the strategy notes in
[`docs/research/`](./docs/research/) for the rationale.

## Pull requests

- Branch from `main`, keep the PR focused, and fill in the PR template.
  `main` is the repository default and the only merge gate (see
  [AGENTS.md](./AGENTS.md)). Do not open PRs against agent working branches.
- Make sure all four gates pass. GitHub branch protection requires the CI job
  **Typecheck & build**, one approving review, and blocks force-pushes/deletes
  on `main`.
- Describe what changed and why; screenshots help for UI changes.
- Run `pnpm test:reviewer` (includes the static reviewer demo checks **and**
  `scripts/check-repo-policy.mjs`) and keep the static reviewer demo
  deterministic. Or run `pnpm check:repo-policy` alone.
- Do not include credentials, real account data, or live model calls in tests,
  fixtures, screenshots, or commits.
- AI-assisted changes must state their evidence and limitations; the maintainer
  makes the human merge decision. See [AGENTS.md](./AGENTS.md) and the
  [AI-assisted development policy](./docs/AI-DEVELOPMENT.md).
- Post–default-branch restore game plan: [docs/GAMEPLAN.md](./docs/GAMEPLAN.md).

## Reporting bugs / requesting features

Use the issue templates. For anything security-sensitive, follow
[SECURITY.md](./SECURITY.md) instead of opening a public issue.
