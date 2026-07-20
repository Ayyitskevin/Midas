# Midas game plan — principal engineer (≈6h autonomous day)

**Date:** 2026-07-20  
**Production tip:** `main` @ `bb63e19` (re-verify before each session)  
**Default branch:** `main` (protected: PR + **Typecheck & build**, no force-push/delete)  
**Open PR this stream:** [#338](https://github.com/Ayyitskevin/Midas/pull/338) (`grok/main-restore-gameplan`)

Budget: **~6 hours of autonomous principal-engineer work per day**. Prefer one
cohesive green-light vertical per day over many partial starts. Protected
`main` requires review — open PRs; do not self-merge when approval is required.

---

## Standing non-goals (every day)

1. **No live order placement** — do not remove or bypass `TradingSafetyHold`.
2. **No invented billing** (#277 deferred; product free/open source).
3. **No force-push of `main`**; no using agent branches as review base.
4. **No self-merge of red-light** money / custody / auth changes.
5. **No mass `claude/phase*` branch deletion** unless explicitly scheduled.

---

## Daily cadence (6h template)

| Block | Hours | Work |
|---|---:|---|
| A · Re-verify | 0.5 | `gh` default + protection + `main` tip; read open PRs/issues |
| B · Plan slice | 0.5 | Pick **one** green-light slice from the ordered list; write acceptance |
| C · Build | 3.5 | Implement + focused tests; keep `TradingSafetyHold` untouched |
| D · Gates | 1.0 | `pnpm test:reviewer`, typecheck, package tests for touched code |
| E · PR + handoff | 0.5 | Push `grok/*`, open/update PR vs `main`, update this file’s “Done” |

If blocked on install/CI env, record the limit; still land pure-logic tests.

---

## Ordered slices

### Done

| # | Slice | Evidence |
|---|---|---|
| 0 | Restore `main` default + protection | Admin applied 2026-07-20 |
| 1 | Repo-policy honesty gate | `scripts/check-repo-policy.mjs` + `pnpm test:reviewer` |
| 2 | Provenance note invariant (shared) | PR #338 — `withHonestNote` |
| 3 | D+1 Shared-hosting operator checklist | PR #340 (open) — `SHARED_HOSTING` + doc↔config gate |
| 4 | **D+2 Stream / liquidations honesty** | `liquidationsFeedLabel` never live for synthetic/mock; stream OPEN until `streamLive===true`; API `honestLiquidationsMeta` |

### Next days (pick one per day)

| Day focus | Slice | Why |
|---|---|---|
| **D+3 (next)** | Docs CI / Pages operator note | Docs workflow fails without Pages env — document honestly |
| D+4 | Minor Dependabot group (only if gates green) | PR #319 minor/patch — not majors (Vite 8 / charts 5) |
| D+5 | #278 friction template | Issue/process only — no product invention |

### Later / human-gated

- Public demo VPS + hero GIF (operator)
- #276 per-user webhooks (design first)
- Execution re-enable only after `docs/EXECUTION_SAFETY_HOLD.md` gate
- #277 billing only after beta validation

---

## Open issues disposition

| Issue | Disposition |
|---|---|
| #278 beta feedback | Process/tracker — green-light docs only |
| #276 per-user webhooks | Design hold |
| #266 waitlist | Social — no code |
| #277 billing | **Do not implement** as settled product |
| Dependabot majors | Review separately; do not auto-merge |

---

## Ship / do-not-ship

| Surface | Verdict |
|---|---|
| Green PRs → `main` after CI + review | **Ship** |
| Hosted live order placement | **Do not ship** until safety-hold re-enable gate |
| Billing / paid tier | **Do not ship** |

---

## Session re-verify commands

```bash
gh repo view Ayyitskevin/Midas --json defaultBranchRef
gh api repos/Ayyitskevin/Midas/branches/main/protection --jq \
  '{contexts:.required_status_checks.contexts,reviews:.required_pull_request_reviews.required_approving_review_count,force:.allow_force_pushes.enabled}'
pnpm test:reviewer
pnpm --filter @midas/server test -- provenance
pnpm -r typecheck
```
