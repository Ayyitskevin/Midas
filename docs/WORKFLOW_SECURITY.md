# GitHub Actions / OpenCode workflow security

Audit of repository workflows against supply-chain and agent-automation threats.
Recorded **2026-07-20** on branch `grok/midas-release-governance`. Re-verify after
any workflow edit.

## Workflow inventory

| Workflow | Triggers | Purpose |
| --- | --- | --- |
| `ci.yml` | `push` to `main`, all `pull_request` | typecheck, build, bundle budget, tests, reviewer demo |
| `docs.yml` | `push` to `main` (docs/web paths), `workflow_dispatch` | MkDocs + static demo → GitHub Pages |
| `opencode.yml` | `issue_comment`, `pull_request_review_comment` | OpenCode agent when comment starts with `/oc` or `/opencode` |

## Threat findings

| Threat | Status | Notes |
| --- | --- | --- |
| Excessive token permissions | **Fixed / least-privilege** | Workflow-level `permissions` default to `contents: read` (and Pages-only writes on docs). OpenCode job keeps `id-token: write` for OIDC + read on contents/PRs/issues — **not** `contents: write` or `pull-requests: write`. |
| Unsafe `pull_request_target` | **N/A** | No workflow uses `pull_request_target`. |
| Untrusted fork execution | **Residual (accepted)** | OpenCode runs on issue/PR **comments** in this repo. `actions/checkout` checks out the workflow repo default branch with `persist-credentials: false` — it does not execute untrusted PR head by default. Residual: a collaborator (or anyone who can comment if issues are open) can *trigger* the agent; cost/abuse is bounded by concurrency + secret presence. |
| Command / prompt injection via issue/PR body | **Mitigated / residual** | Trigger matching uses GitHub Actions expressions (`startsWith` / `contains`) — not shell interpolation of the comment into `run:`. The third-party OpenCode action still *receives* the comment text as agent context (inherent to the product). Residual: untrusted natural-language instructions to the model. Do not expand permissions to grant the agent write without a human gate. |
| Secret exposure | **OK** | `OPENCODE_API_KEY` only via `${{ secrets.OPENCODE_API_KEY }}`. Checkout does not persist credentials. No secrets echoed in logs by our YAML. |
| Unpinned third-party actions | **Fixed (OpenCode)** | `anomalyco/opencode/github` was `@latest` (mutable). Pinned to full commit SHA `a3b97d9090ccf4aa9ac32268486283e3131e36b4` (latest commit that updates `github/` as of audit). First-party `actions/*` remain on major tags (`v4`/`v5`/`v6`) — Dependabot majors deferred; see `DEPENDENCY_MIGRATION.md`. |
| Artifact poisoning | **Low** | Docs job builds from checked-out `main` (or dispatch) and uploads Pages artifact from local `site/`. No download of untrusted workflow artifacts into a privileged job. |
| Uncontrolled write access | **OK** | OpenCode permissions are read-scoped. Docs deploy uses OIDC Pages write only in the deploy job. CI has no write permissions beyond the default GITHUB_TOKEN for status. |
| Concurrency / runaway cost | **Fixed** | `opencode.yml` and `ci.yml` use `concurrency` groups with `cancel-in-progress`. OpenCode still incurs model cost per qualifying comment when the secret is set — residual operator cost control is rotating/removing `OPENCODE_API_KEY` or disabling the workflow. |

## OpenCode pin refresh (operators)

When upstream ships a fix you need:

```bash
# Latest commit that touches the GitHub action package:
gh api "repos/anomalyco/opencode/commits?path=github&per_page=1" --jq '.[0].sha'
# Then set uses: anomalyco/opencode/github@<full-sha>
# Re-run: node scripts/check-release-governance.mjs
```

Do **not** reintroduce `@latest` or a floating major-only tag for this third-party
agent action.

## Replacement if OpenCode is disabled

If the workflow is turned off, operators lose comment-triggered agent runs.
Replacement: run OpenCode (or another agent) locally / in a maintainer-controlled
environment with a checkout of `main` or a feature branch, and open draft PRs
manually. Document the disablement in the PR that removes the workflow.

## Related

- [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) — host/env hardening
- [`BRANCH_GOVERNANCE.md`](./BRANCH_GOVERNANCE.md) — default branch truth
- [`DEPENDENCY_MIGRATION.md`](./DEPENDENCY_MIGRATION.md) — Actions major bumps deferred
