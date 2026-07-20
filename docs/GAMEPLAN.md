# Midas game plan — post–`main` restore

**Date:** 2026-07-20  
**Production tip:** `main` @ `bb63e19` (PR #337 product history + OpenCode workflow)  
**Default branch:** `main` (restored; was `claude/modest-ride-sclvg3`)  
**Protection:** PR required (1 approval), required check **Typecheck & build**, force-push/delete blocked  

This plan is the ordered path after restoring `main` as the protected merge gate.
It does **not** authorize live order placement or invent billing policy.

---

## Current state (verified)

| Fact | Value |
|---|---|
| Repo | `Ayyitskevin/Midas` |
| Default | `main` |
| Tip | Includes merge PR #337 (MCAP/TOP board) + OpenCode workflow |
| CI | `.github/workflows/ci.yml` job name `Typecheck & build` |
| Execution | Fail-closed `TradingSafetyHold` on `POST/DELETE /api/orders` |
| Open issues | #278 feedback, #277 billing (deferred), #276 webhooks, #266 waitlist |

## Standing non-goals

1. **No live order placement** — do not remove or bypass `TradingSafetyHold` until the re-enable gate in `docs/EXECUTION_SAFETY_HOLD.md` is fully met and maintainer-approved.
2. **No invented billing** — issue #277 is a future discussion; product remains free/open source per ROADMAP.
3. **No App Store / privacy-label invention** — not a mobile App Store product.
4. **No mass agent-branch deletion** unless explicitly scheduled and safe.
5. **No silent self-merge of red-light money/custody/auth changes.**

---

## Ordered next slices

### Done this session

0. **Restore `main` as default + protect it** — verify diverged history; cherry-pick OpenCode onto `main`; set default; branch protection with PR + CI.
1. **Repo-policy honesty gate** — automated check that AGENTS/CONTRIBUTING/safety-hold docs still encode merge base + execution hold (this PR).

### Next (green-light, pick one per PR)

2. **Docs CI / Pages operator checklist** — Docs workflow failures on `main` are often Pages environment config; document enablement without claiming deploy succeeded.
3. **Roadmap v3 friction list (#278)** — wire issue template / weekly triage note only; no product invention.
4. **Honesty regression hunt** — extend provenance labels on any surface still missing `live|synthetic|unavailable` (data-honesty skill).
5. **Shared-hosting guide polish** — multi-user env end-to-end in self-host docs (ROADMAP Week 2 remainder).

### Later / human-gated

6. **Public demo VPS + hero GIF** — operator launch blockers (ROADMAP Week 1).
7. **Per-user webhooks + digests (#276)** — design first, durable store.
8. **Execution re-enable** — only after `EXECUTION_SAFETY_HOLD.md` re-enable gate; red-light PR.
9. **Billing (#277)** — only after beta validation; do not implement as settled product.

---

## Ship / do-not-ship (hosted execution)

| Surface | Verdict |
|---|---|
| Merging green-light PRs to `main` | **Ship** via PR + CI + review |
| Hosted instance deploy | Operator choice; keep demo mode for public |
| Live order placement | **Do not ship** until safety-hold re-enable gate |

---

## How to re-verify branch health

```bash
gh repo view Ayyitskevin/Midas --json defaultBranchRef
gh api repos/Ayyitskevin/Midas/branches/main/protection --jq '.required_status_checks.contexts,.required_pull_request_reviews.required_approving_review_count,.allow_force_pushes,.allow_deletions'
pnpm test:reviewer   # includes repo-policy checks after this slice
```
