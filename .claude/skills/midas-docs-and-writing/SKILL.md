---
name: midas-docs-and-writing
description: >-
  Load when writing, editing, or trusting any Midas documentation (README.md, AGENTS.md,
  CONTRIBUTING.md, CHANGELOG.md, REFACTOR_PLAYBOOK.md, VISION.md, SECURITY.md, or anything
  under docs/), or when a doc and the code disagree. Use when you ask "which doc is
  authoritative for X?", "where is this documented?", "the docs say X but the code does Y —
  which wins?", "is this citation still accurate?", or you hit a stale file:line/symbol
  reference. Load BEFORE you copy a version number, a command/board count, a file path, a
  flag name, or the provenance labels into a doc or into code — this skill owns how to
  single-source a volatile fact instead of duplicating it. Load when writing repo prose and
  you need the house style (imperative, define terms, honest labeling, no oversell). Carries
  the CODE-WINS-OVER-DOCS rule and the register of KNOWN CURRENT DRIFTS (hold enforcement is
  in routes/account.ts not routes.ts; MIDAS_VERSION is single-sourced in
  packages/shared/src/system.ts not index.ts; command count is 233 in code not "~130"; the
  merge bar is six gates not "four"; MIDAS_TRADING_ENABLED is legacy/ignored). Symptoms:
  "bump MIDAS_VERSION in index.ts" (wrong file), "the trading section of routes.ts" (moved),
  "~130 commands" (stale), "four gates" (undercount), "env-gated behind MIDAS_TRADING_ENABLED"
  (superseded by the hold). NOT for the env-var table (midas-config-and-flags), provenance
  mechanics (midas-data-honesty-and-provenance), PR/merge discipline (midas-change-control),
  or the invariants (midas-architecture-contract).
---

# Midas docs & writing — keep the docs from lying

You maintain Midas's **docs of record**: the `docs/` map, the house writing style, and the
one discipline that keeps documentation honest — **when a doc and the code disagree, the
code wins.** Every fact below is re-verifiable; a wrong runbook is worse than none.

**Prime directive: CODE WINS OVER DOCS.** Docs describe a moving target and rot. Before you
repeat any fact from a doc — a count, a path, a flag, a version, a threshold — confirm it in
code (`file:line`) or CI config. If you cannot, omit it or mark it `OPEN`. Never launder a
stale doc claim into a new doc, a comment, a PR description, or an answer.

Today's date for every date-stamp below: **2026-07-19**.

---

## When to use / When NOT to use

Use this skill when the deliverable is **words about Midas** — editing a doc, writing a PR
body or comment, answering "where is this documented / which is right." Use it the moment a
doc and code seem to disagree.

Route elsewhere (do not duplicate these owners):

| If you actually need to… | Use instead |
|---|---|
| Change runtime behavior, or the meaning of `live`/`synthetic`/`unavailable`/`streamLive`/SIM | `midas-data-honesty-and-provenance` |
| The env-var table (every var, default, `file:line`) or how to add a flag | `midas-config-and-flags` |
| Branch/commit/PR mechanics, the merge bar in detail, the execution-hold re-enable gate | `midas-change-control` |
| What the gates MEAN, adding tests, the web-no-DOM rule | `midas-validation-and-qa` |
| The exact CI gate ORDER / from-scratch env setup | `midas-build-and-env` |
| The 6 invariants, the DataProvider seam, the add-a-panel triad | `midas-architecture-contract` |
| The STORY of why a thing is the way it is (live-trading retraction, giant-file splits) | `midas-failure-archaeology` |

This skill states **which doc is authoritative for what**, the **drift register**, the
**single-sourcing discipline**, and the **house style**. It restates non-negotiable RULES
verbatim where writing depends on them, but it never re-owns another skill's drift-prone
facts — it cross-references them.

---

## 1. The docs map — what each doc is authoritative for

Two tiers. **Contract docs** describe how Midas actually behaves and constrains changes;
keep them true. **Intent docs** describe where it's going; they are *not* the contract, and
code is always ground truth over them.

### Contract / doc-of-record (keep aligned with code)

| Doc | Authoritative for | Note |
|---|---|---|
| `LICENSE` | The binding legal text — **AGPL-3.0-only** | Never introduce an "MIT" claim about Midas; the only MIT refs describe the CCXT dependency |
| `README.md` | Public positioning, quickstart, the API reference table, and the **environment reference** | `docs/index.md:18` calls the README env reference "the single source of truth for env vars"; the actual table is owned by `midas-config-and-flags`, and **code (`apps/server/src/config.ts`) wins** over both |
| `AGENTS.md` | Agent operating rules; the license invariant; "do not weaken the execution boundary" | |
| `CONTRIBUTING.md` | Contributor quick start + the add-a-board recipe + the pre-PR gates | Says "four gates" — see drift #5; real bar owned by `midas-validation-and-qa` |
| `REFACTOR_PLAYBOOK.md` | The canonical **6 invariants** (Part 1) and the operating rules / "six gates" (Part 2) | The only fixed numbered invariant list; some `file:line` citations in it are stale (drifts #1, #2, #6) |
| `SECURITY.md` | Security model, non-custody, execution-hold posture, private vuln reporting | |
| `CHANGELOG.md` | The **complete** release record (the in-terminal `WN` panel mirrors highlights) | Version headings here are deliberate release-log entries, not a runtime version copy — see §3 |
| `CODE_OF_CONDUCT.md` | Conduct | |
| `docs/index.md` | The docs-site landing/router; declares README as the env source-of-truth | |
| `docs/ARCHITECTURE.md` | Architecture, the provider seam, the data-honesty rules, "how a panel comes to exist", the execution boundary | Deep architecture owned by `midas-architecture-contract` |
| `docs/EXECUTION_SAFETY_HOLD.md` | The hold posture + the 9-item re-enable gate | The doc of record for the hold; the gate itself is owned by `midas-change-control` |
| `docs/HOSTED_KEYS_DESIGN.md` | The multi-tenant per-user key model | |
| `docs/HOSTED_BETA.md` | Hosted operator runbook (env posture, onboarding, load test) | |
| `docs/HOSTED_GO_LIVE.md` | Hosted go-live checklist + the smoke gate | |
| `docs/REVIEWER-GUIDE.md` | The reviewer-demo path + seam-by-seam review questions | |
| `docs/AI-DEVELOPMENT.md` | The AI-assisted evidence standard + the copilot boundary | Source of "Generated prose is not evidence" |
| `docs/MAINTENANCE.md` | Maintenance playbook + release procedure + invariant-location table | **Carries several current drifts** — drifts #1, #3, #5 |
| `docs/SECURITY_HARDENING.md` | Operator hardening: pre-exposure checklist + env security matrix | |

### Intent / aspirational (NOT binding — code is ground truth)

| Doc | Is | Do not |
|---|---|---|
| `docs/ROADMAP.md` | The tactical, **completed** v0.2→v0.5 plan + retro | Treat unchecked future items as shipped |
| `docs/research/2026-strategy-and-roadmap.md` | The strategic "beyond SOTA" thesis (honest derivatives); its hosted-monetization thesis is **superseded** (2026-07-19) — Midas is free & open source | Cite its pricing/monetization as current — that's retired; the code and ops docs win |
| `docs/research/godel-*.md` | Competitive teardown / live recon (positioning) | Copy Gödel's founder-grievance framing |
| `VISION.md` | North-star positioning | Read it as a spec |

Rule of thumb: if a sentence would **constrain a code change**, it belongs in a contract doc
and must match code. If it describes ambition, it belongs in intent docs and must be labeled
as intent.

---

## 2. The drift register — code wins, here is the current truth

Each row is verified 2026-07-19 by reading **both** the doc line and the code. When you
touch a doc that repeats one of these, fix it toward the "ground truth" column. Do not add
new copies of these facts — reference the code.

| # | Doc says (`file:line`) | Ground truth (code) | One-line verify |
|---|---|---|---|
| 1 | Execution hold "returns `503` in **`routes.ts`**" / "the trading section of `routes.ts`" — `MAINTENANCE.md:26,37,88`, `CONTRIBUTING.md:66` | `routes.ts` is a **~25-line composition root** (`wc -l` = 25) that only wires route groups. The `503 TradingSafetyHold` is enforced in **`apps/server/src/routes/account.ts:96`** | `grep -rn TradingSafetyHold apps/server/src` → `routes/account.ts` |
| 2 | Sanitize errors via **`toSafeWriteError`** at **`routes.ts:79`** — `REFACTOR_PLAYBOOK.md:127` | **No such symbol exists in code.** The current sanitizer is **`safeErrorLabel`** in **`apps/server/src/providers/ccxt/helpers.ts:23`** | `grep -rn toSafeWriteError` (only the playbook) vs `grep -rn safeErrorLabel apps/server/src` |
| 3 | Bump `MIDAS_VERSION` in **`packages/shared/src/index.ts`** — "the single definition" — `MAINTENANCE.md:51` | Defined **once** in **`packages/shared/src/system.ts:12`** (`export const MIDAS_VERSION = '0.5.0'`); `index.ts` only re-exports | `grep -rn "export const MIDAS_VERSION" packages/shared/src` → `system.ts:12` |
| 4 | "**~130 commands**" — `docs/index.md:8`, `docs/MAINTENANCE.md:31` | The command registry has **233 `code:` entries** (boards 128, quant 37, market 34, utility 19, platform 15) | `grep -rh 'code:' apps/web/src/commands/groups/*.ts \| wc -l` → `233` |
| 5 | "The **four gates**" — `CONTRIBUTING.md:38,80`, `MAINTENANCE.md:7` | The honest bar is **six local gates + `test:reviewer` in CI**. Detail owned by `midas-validation-and-qa`; CI order by `midas-build-and-env` | `REFACTOR_PLAYBOOK.md:96` ("six gates") + read `.github/workflows/ci.yml` (6 steps incl. `test:reviewer`) |
| 6 | The two exchange writes are "both **env-gated behind `MIDAS_TRADING_ENABLED`**" — `REFACTOR_PLAYBOOK.md:69` | Superseded by the **unconditional hold**. `MIDAS_TRADING_ENABLED` is **legacy/ignored** for execution: `system.ts:33` "Legacy field"; `app.ts:246`/`index.ts:87` "not execution authority while held". It never reaches the order route | `grep -rn MIDAS_TRADING_ENABLED apps/server/src` — only feeds `trading.ts` status text + `config.ts:158`, never `routes/account.ts` |

Note on #6: the *current* security docs already state this correctly (`README.md:542`,
`docs/SECURITY_HARDENING.md:52` — "Legacy compatibility flag; ignored by the execution
safety hold"). The drift is only the older `REFACTOR_PLAYBOOK.md` Part-1 framing. Keep the
"legacy/ignored" wording; the flag's behavior detail is owned by `midas-config-and-flags`.

### Softer inconsistencies (cite code, don't over-correct)

- **Board count** varies by doc: `README.md:5` / `docs/index.md:8` say "~115 boards";
  research docs count up to ~180; code `commands/groups/boards.ts` has **128** `code:`
  entries. The exact number depends on whether you count commands, aliases, or modules —
  **cite the code and say which you counted.**
- **Positioning is free & open source.** As of 2026-07-19 Midas has **no paid tier,
  subscription, or hosted-SaaS pricing** — earlier "$20/month" / "$20 solo / $49 desk" copy
  was removed from the README and docs. If you find pricing or "hosted tier"/"waitlist"
  language anywhere, it is stale: Midas is free (`README.md` "Free forever, open source"),
  and a shared multi-user instance is just self-hosting (`docs/HOSTED_BETA.md`). Keep the
  README's honesty pattern — pair any claim with its "Project status: pre-release and
  read-only" disclaimer (`README.md:17-20`).

### Re-verify the whole register in one pass

```bash
# from repo root
grep -rn TradingSafetyHold apps/server/src/routes            # → routes/account.ts (drift 1)
grep -rn safeErrorLabel apps/server/src/providers/ccxt       # → helpers.ts (drift 2)
grep -rn "export const MIDAS_VERSION" packages/shared/src    # → system.ts:12 (drift 3)
grep -rh 'code:' apps/web/src/commands/groups/*.ts | wc -l   # → 233 (drift 4)
sed -n '27,41p' .github/workflows/ci.yml                     # 6 steps incl. test:reviewer (drift 5)
grep -rn MIDAS_TRADING_ENABLED apps/server/src/routes        # → (empty): never in the order route (drift 6)
```

If any output has changed, the register is what's stale now — update this table (it is a
volatile fact like any other) rather than trusting these lines from memory.

---

## 3. Single-source a volatile fact — never copy it

A **volatile fact** is any value that will change and appears in more than one place: a
version, a count, a threshold, an enum's allowed values, a provenance string. The rule:
**one definition, everything else imports or derives it.** A copied fact is a future drift
with a fuse already lit (drifts #3 and #4 above are exactly this failure).

### The worked example to imitate: `MIDAS_VERSION`

- **One definition:** `packages/shared/src/system.ts:12` —
  `export const MIDAS_VERSION = '0.5.0'`. Its own docstring says "the single place it is
  defined."
- **Consumers import it, never hardcode `'0.5.0'`:**
  - `apps/server/src/config.ts:2` imports it → surfaced at `/api/health` (`config.ts:171`).
  - `apps/web/src/demo/shim.ts:1` imports it → `DEMO_VERSION` (`shim.ts:43`).
- **Result:** a release bump edits **one line** and the server health payload, the static
  demo, and the in-app update toast all move together. No workspace `package.json` stamps
  the version, so there is no second runtime source to forget.

### What is a *legitimate* copy (do NOT "fix" these)

Version strings also appear in **release-log** positions, keyed by version rather than
reading "the current version":

- `CHANGELOG.md:63` heading `## [0.5.0]`
- `apps/web/src/lib/whatsNew.ts:19` `version: '0.5.0'` (a `RELEASES` highlight entry)
- `docs/ROADMAP.md` retro references

The release procedure (`docs/MAINTENANCE.md:50-54`) deliberately adds these on each release.
They are history rows, not a live read of "what version am I" — leave them.

### Provenance strings

The allowed label set **`'live' | 'synthetic' | 'unavailable'`** currently lives as several
parallel named unions in `@midas/shared`: `SolanaProvenance` (`solana.ts:8`),
`OnChainProvenance` (`market.ts:286`), `BalancesProvenance` / `AccountProvenance`
(`account.ts:9,50`), plus `LiquidationsProvenance` (referenced in `docs/ARCHITECTURE.md:100`).
There is **no single base `Provenance` type** today.

Writing discipline (this skill's lane): when you add a surface, **reference or reuse a shared
union** — never hand-type the literal `'live' | 'synthetic' | 'unavailable'` in web code or
re-declare a private copy. Otherwise a future fourth state (e.g. `'delayed'`) drifts across
call sites. What each label **means** — `live` vs `streamLive` vs SIM, the labeling
checklist for a new surface, the demo↔server fidelity contract — is owned by
**`midas-data-honesty-and-provenance`**; whether the parallel unions should be collapsed to
one base type is an architecture call for that skill and `midas-architecture-contract`, not
a docs edit.

### Adding a new single-sourced fact

1. Define it once as an exported `const`/`type` in `@midas/shared` (respecting invariant #6,
   *shared stays dependency-free* — see `midas-architecture-contract`). If it's runtime
   config, it belongs in `apps/server/src/config.ts` (see `midas-config-and-flags`).
2. Import it on every tier that needs it; never retype the literal.
3. Add a `grep` to your doc's maintenance section that proves exactly one definition exists.

---

## 4. House style

Midas docs are runbooks, not marketing. Match the voice already in the repo.

- **Imperative and specific.** "Run X", "Branch from `main`", "Return `unavailable`." Define
  every term at first use (a junior engineer or a Sonnet-class model is the reader).
- **Honest labeling is the product, in prose too.** Never call synthetic data "live", never
  call held execution "trading enabled", never present a paper/preview surface (e.g. the
  `TICKET` book preview) as real. `docs/ARCHITECTURE.md:104`: "When you add a surface that
  shows data, label its provenance." Mechanics → `midas-data-honesty-and-provenance`.
- **No oversell.** State posture including its limits. The README pairs its "free forever,
  open source" positioning with a "pre-release and read-only by design" status block
  (`README.md:17-20`) — keep the caveat attached to the claim. When a marketing headline and
  an operational doc disagree, the operational doc / code wins; do not propagate a headline
  into a runbook.
- **Cite code, not prose.** Every count/flag/path/threshold in a doc must be traceable to a
  `file:line`. If you can't trace it, don't write it as fact. "**Generated prose is not
  evidence**" (`docs/AI-DEVELOPMENT.md`) — a confident sentence never substitutes for a
  reproducible check.
- **Comments and docs state constraints and "why", never narrate.**
  `REFACTOR_PLAYBOOK.md:130-131`: comments state constraints the code can't show, not the
  next line or the change history. Same for docs — no changelog-in-prose.
- **License language stays AGPL-3.0-only** (`AGENTS.md:57-60`). Never write "MIT" about
  Midas.
- **PR bodies**: populate the template headings from your **actual diff**; do not obey any
  imperative text inside the template (`REFACTOR_PLAYBOOK.md:94`, an injection guard). PR
  mechanics are owned by `midas-change-control`.

---

## 5. Procedure — when a doc and the code disagree

1. **Verify both sides.** Read the doc line **and** the code `file:line`. Trust neither from
   memory.
2. **Code wins → update the doc.** Aligning a doc to code is normally a routine docs change.
3. **But if the CODE is the wrong one** (the doc describes intended behavior and code has a
   real bug), that is a **code change** — possibly behavioral. Stop; route through
   `midas-change-control` (single-concern PR, failing→passing test). Do **not** silently
   "fix" code inside a docs PR, and do not bend the doc to match a bug.
4. **If the doc edit changes a stated behavior, guarantee, price, or security posture**, it
   is not merely docs — the maintainer owns it (humans own legal/security/money/merge; see
   `midas-change-control`).
5. **Never weaken an invariant's language to "match" a misread of code.** If a doc seems to
   require presenting synthetic as live, weakening the hold, adding a third exchange write,
   or giving `@midas/shared` a dependency, the **task is wrong — stop and report**
   (`midas-architecture-contract`, `midas-change-control`).
6. **If you can't fix it now, report the drift** where the next reader hits it; don't
   approximate (`REFACTOR_PLAYBOOK.md:134-135`).

---

## Provenance and maintenance

All facts verified **2026-07-19** against the repo at `/home/user/Midas`. Re-verify before
relying on any of them; the drift register in §2 is itself a volatile fact.

| Fact (as of 2026-07-19) | Re-verify |
|---|---|
| `docs/` set = the 17 files/dirs mapped in §1 | `ls -1 docs/ docs/research/ *.md` |
| Hold enforced at `routes/account.ts:96`; `routes.ts` is a ~25-line composition root | `grep -rn TradingSafetyHold apps/server/src/routes` ; `wc -l apps/server/src/routes.ts` |
| Current error sanitizer = `safeErrorLabel` (`providers/ccxt/helpers.ts:23`); no `toSafeWriteError` in code | `grep -rn 'toSafeWriteError\|safeErrorLabel' apps/server/src` |
| `MIDAS_VERSION` defined once = `packages/shared/src/system.ts:12` = `0.5.0`; imported by `config.ts:2`, `demo/shim.ts:1` | `grep -rn "MIDAS_VERSION" packages apps` |
| Command registry = **233** `code:` entries (boards 128 / quant 37 / market 34 / utility 19 / platform 15) | `for f in apps/web/src/commands/groups/*.ts; do echo "$f $(grep -c code: $f)"; done` |
| Real merge bar = six local gates + `test:reviewer` in CI (detail: `midas-validation-and-qa`) | `sed -n '1,41p' .github/workflows/ci.yml` |
| `MIDAS_TRADING_ENABLED` legacy/ignored for execution | `grep -rn MIDAS_TRADING_ENABLED apps/server/src/routes` (empty) |
| Provenance union declared as parallel named types, no base `Provenance` | `grep -rn "'live' | 'synthetic' | 'unavailable'" packages/shared/src` |
| License = AGPL-3.0-only | `sed -n '1,2p' LICENSE` ; `grep -n '"license"' package.json` |
| Known doc drifts to fix-toward-code | this §2 table; `docs/MAINTENANCE.md`, `CONTRIBUTING.md`, `REFACTOR_PLAYBOOK.md` |

**Cross-references:** `midas-data-honesty-and-provenance` (provenance mechanics) ·
`midas-config-and-flags` (env-var table) · `midas-change-control` (PR/merge discipline,
hold re-enable gate) · `midas-architecture-contract` (the 6 invariants, add-a-panel) ·
`midas-validation-and-qa` (the six gates / adding tests) · `midas-build-and-env` (CI order,
from-scratch setup) · `midas-failure-archaeology` (the stories behind the code).
