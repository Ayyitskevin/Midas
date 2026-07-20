# Branch governance — `main` is authoritative

This document records live branch state, residual history from the old
feature-session default, and an exact **reversible operator plan** for keeping
`main` authoritative. It does **not** change GitHub repository settings; an
operator applies settings steps only when needed and with human approval.

## Live state (recorded 2026-07-20)

| Fact | Value |
| --- | --- |
| GitHub default branch | `main` (verified via `gh repo view … defaultBranchRef`) |
| `main` tip | `bb63e19` — includes PR #337 content + OpenCode workflow |
| Historical session branch | `claude/modest-ride-sclvg3` tip `beb7a1d` |
| Merge-base | `d0883bb` (`feat(coins): market-cap reference layer + TOP board`) |
| Divergence | **2 commits on `main` not on session branch** (merge PR #337 + OpenCode on `main`); **1 commit on session branch not on `main`** |

### Commits unique to each side

**On `main`, not on `claude/modest-ride-sclvg3`:**

1. `8fb30ff` — Merge pull request #337 from `claude/modest-ride-sclvg3`
2. `bb63e19` — `chore: add OpenCode GitHub agent workflow (update)`

**On `claude/modest-ride-sclvg3`, not on `main`:**

1. `beb7a1d` — `chore: add OpenCode GitHub agent workflow (update)`

The two OpenCode commits are **byte-identical** workflow content (same
`opencode.yml` text) but different commit SHAs because each was authored on a
different parent (`main` after the merge vs the session tip). There is **no
product code** unique to the session branch that `main` lacks.

Local clones may still show `origin/HEAD -> origin/claude/modest-ride-sclvg3`
until `git remote set-head origin -a` refreshes the symbolic ref. That is a
local remote-tracking quirk, **not** the GitHub default-branch setting.

## Ship-path assumptions

These must treat `main` as the merge base and default:

| Surface | Expectation |
| --- | --- |
| CI (`.github/workflows/ci.yml`) | `push.branches: [main]`; PRs target `main` |
| Docs Pages (`.github/workflows/docs.yml`) | deploys on pushes to `main` |
| `AGENTS.md` / `CONTRIBUTING.md` / skills | branch from `origin/main`; open PRs against `main` |
| Reviewer / maintenance docs | gates and release tags on `main` |

Feature-session branch names (`claude/modest-ride-sclvg3`, `claude/phase*`) may
appear only as **historical** references in this doc or archaeology notes — never
as the production default, merge base, or deploy branch.

## Reversible plan: keep `main` authoritative

Do **not** automate the steps below from an agent PR. An operator runs them.

### Already done on GitHub (do not re-apply blindly)

1. Default branch set to `main`.
2. Branch protection on `main` (require PR + review, required status check
   **Typecheck & build**, no force-push/delete) — as claimed by the post-restore
   game plan work. Re-verify under **Settings → Branches** before trusting.

### If a clone or doc still treats the session branch as default

1. **Refresh local remote HEAD** (safe, local only):
   ```bash
   git remote set-head origin -a
   git fetch origin main
   git checkout -B <work> origin/main
   ```
2. **Confirm GitHub default** (read-only):
   ```bash
   gh repo view Ayyitskevin/Midas --json defaultBranchRef
   ```
3. **If product work ever lands only on the session branch** (not the case as of
   this recording): merge it into `main` with a normal PR — **never force-push
   `main`**, never delete `main`.
4. **Optional cleanup of the session branch tip**: if `beb7a1d` is redundant with
   `bb63e19`, leave the branch as historical or delete it only after confirming
   no open PR bases on it. Deletion is reversible only if another remote still
   has the ref; prefer tagging first:
   ```bash
   git tag archive/modest-ride-sclvg3 beb7a1d
   git push origin archive/modest-ride-sclvg3
   # only then, and only with maintainer approval:
   # git push origin --delete claude/modest-ride-sclvg3
   ```

### Rollback of a mistaken default-branch change

If someone points the GitHub default away from `main`:

1. Settings → General → Default branch → `main` (or
   `gh api -X PATCH repos/Ayyitskevin/Midas -f default_branch=main` with admin).
2. Re-apply branch protection on `main` if it was cleared.
3. Do **not** force-push. Recover tips with merge commits or revert PRs.

### Rollback of this documentation PR

Revert the commits on `grok/midas-release-governance` (or the merge commit on
`main`). No repository settings are modified by the documentation alone.

## Relationship to other work

- PR **#338** (`grok/main-restore-gameplan`) adds a post-restore GAMEPLAN and a
  repo-policy script. This file is intentionally separate so the two PRs do not
  write-race the same paths.
- Do not mass-delete `claude/phase*` branches as part of governance cleanup.

## Verification

```bash
gh repo view Ayyitskevin/Midas --json defaultBranchRef
git fetch origin
git rev-list --left-right --count origin/main...origin/claude/modest-ride-sclvg3
node scripts/check-release-governance.mjs
```
