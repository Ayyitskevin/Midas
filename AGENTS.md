# Midas repository instructions

Midas is a pre-release, self-hosted market-research terminal. Treat the
repository as a safety-sensitive read-only system: it does not custody funds,
and the execution hold is the authority for order placement and cancellation.

## Review and branch discipline

- `main` is the review base and merge gate. It is also the GitHub default branch —
  branch from `origin/main` and open PRs against `main`. Historical
  feature-session branches (`claude/modest-ride-sclvg3`, `claude/phase*`) are
  not merge bases — see [`docs/BRANCH_GOVERNANCE.md`](docs/BRANCH_GOVERNANCE.md).
- Keep changes narrow and leave agent-authored work in a draft pull request for
  the maintainer. Do not merge, deploy, restart a hosted instance, or change
  exchange configuration as part of a code change.
- Read `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and the relevant design
  docs before editing. Preserve the data-honesty and non-custodial invariants.

## Data and credential boundaries

- Tests and demos use the deterministic `mock` provider or the in-browser
  static demo. They must not call an exchange, Anthropic, a webhook, or a
  hosted instance.
- Never read, print, commit, or send API keys, secrets, cookies, real account
  data, or private workspace state. Use disposable local paths and synthetic
  fixtures.
- Every surface labels data as live, synthetic/demo, or unavailable. Missing
  evidence is not permission to fabricate a value.
- `POST /api/orders` and `DELETE /api/orders/:id` remain fail-closed with
  `503 TradingSafetyHold`. Do not weaken this boundary through an environment
  flag, a test helper, or UI copy.

## Required verification

Before requesting review, run the applicable gates:

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm test
pnpm build
node scripts/check-bundle.mjs
pnpm --filter @midas/web build:demo
pnpm test:reviewer
```

For server changes, include the focused Vitest command and the full suite
result. For web changes, include the web tests, production build, static demo
build, and bundle result. Explain anything that could not run and why.

## Product AI versus AI-assisted development

The optional `AI` copilot is a paid, outbound Anthropic integration enabled only
when an operator supplies `ANTHROPIC_API_KEY`; it is not part of the static demo
or CI. Coding agents may propose or implement changes, but the maintainer owns
the legal, security, money, and merge decisions. Follow
[`docs/AI-DEVELOPMENT.md`](docs/AI-DEVELOPMENT.md) for the evidence standard.

## License

The repository is licensed under AGPL-3.0-only. Keep root and package metadata,
documentation, and contribution language aligned with `LICENSE`.
