---
name: midas-research-frontier
description: >-
  The open problems where Midas could advance the state of the art, plus how Midas is
  positioned externally. Load this when the question is STRATEGIC or POSITIONING, not a code
  change: "what should Midas build next", "where can we beat the incumbents / advance SOTA",
  "what are the open problems / research frontier", "is this actually novel", "can we claim X
  yet", "what's provable vs marketing", "why AGPL / free and open source", "self-host vs a
  shared instance", "is the honest cross-exchange derivatives angle real", "reliable per-user
  alerts from a shared instance", "durable multi-user self-hosting (the DB-adapter seam)",
  "trust wedge", "competitive moat", "what must we PROVE before saying it". This skill FRAMES
  the #1 frontier problem as an open problem and hands execution to
  midas-honest-derivatives-campaign. It does NOT own the executable campaign, the domain math
  (crypto-market-reference), doc style (midas-docs-and-writing), or the change gate
  (midas-change-control). Every strategic claim here is cited to the roadmap docs; anything not
  yet built or measured is labeled OPEN or CANDIDATE, never stated as fact. Midas is free and
  open source — there is no paid tier or hosted business.
---

# Midas — research frontier & external positioning

This skill answers two kinds of question:

1. **Frontier** — *where could Midas advance the state of the art, and how would you start in
   this repo?* Three open problems, each with: why current SOTA fails, the specific Midas asset
   that makes it winnable, the first 3 concrete steps IN THIS REPO, and a falsifiable "you have a
   result when…" milestone.
2. **Positioning** — *how is Midas positioned externally, what is genuinely novel vs commodity,
   and what must be PROVEN before you may claim it?*

**The one rule that governs everything below.** Strategy is not code. Every strategic claim is
cited to `docs/research/2026-strategy-and-roadmap.md` (the forward "beyond SOTA" thesis) or
`docs/ROADMAP.md` (the tactical, shipped plan). Anything not yet built or not yet measured is
labeled **OPEN** (unresolved question) or **CANDIDATE** (proposed, unproven) — never asserted as
fact. If you catch yourself writing a number Midas has not measured, stop: measure it first or
label it CANDIDATE. "Generated prose is not evidence" (`docs/AI-DEVELOPMENT.md:28-31`).

Vocabulary (define-on-first-use): **SOTA** = state of the art. **Trust wedge** = a place where
being *honest* about data everyone else fudges becomes the differentiator. **Free and open
source** = the whole terminal is AGPL-3.0 and costs nothing; there is no paid tier, and an
optional shared multi-user instance is just another way to self-host. **Prosumer** = a serious
individual trader below an institutional desk (the target user, `2026-strategy §header`).

---

## Part 1 — The frontier: three open problems

Read each card as: *problem → why nobody has nailed it → what Midas already has → your first 3
moves here → how you know you succeeded.* The problems are ranked by strategic leverage
(`2026-strategy §5, §7`). Do **not** invent expected numbers in any milestone — where a baseline
is missing, the step says to measure it first.

### Problem 1 — Honest, cross-exchange derivatives (the trust wedge) — #1 priority

This is the owner-chosen hardest problem. **This skill only FRAMES it. The decision-gated,
executable plan lives in `midas-honest-derivatives-campaign` — go there to actually do the work.**

| Field | Content |
|---|---|
| **The open problem** | Aggregate funding / open interest (OI) / **liquidations** across venues and label each number's **source + staleness + known-throttling**, so a trader can trust it. |
| **Why current SOTA fails** | Exchange liquidation feeds are throttled to ~1/sec and **underreport actual volume 6–20×** (Bybit's CEO: $2.1B internal vs $333M shown; feeds "unreliable since 2021"). Traders use liq clusters as leading signals but cannot trust the numbers, and **"nobody is honest about this"** (`2026-strategy §4:106-111`). Competitors (CoinGlass et al.) show cross-exchange liq heatmaps but present the underreported numbers unlabeled (`§3:80-82`). |
| **Midas's specific asset** | The honesty is already partly *in the code*, not just aspirational: `apps/server/src/providers/ccxt.ts:415-419` `liquidationsProvenance()` already returns a note stating the feed is throttled and under-reports, and that Binance removed its public stream in 2021; the DataProvider contract carries it (`providers/types.ts:64-66`). The **cross-venue fan-out seam** exists: `routes/market.ts:49` `registerVenueBoard`, wiring `/api/funding-dispersion`, `/api/venue-arb`, `/api/oi-concentration` (`market.ts:242-260`) over `provider.getVenueDerivatives`. Data-honesty is a hard product invariant, so honest labeling is a first-class right, not a bolt-on (see `midas-data-honesty-and-provenance`). |
| **First 3 steps IN THIS REPO** | 1. Read the three seams above (`ccxt.ts:415-419`, `routes/market.ts:49,242-260`, `providers/types.ts:64-66`) so you know exactly what is already built. 2. Establish the baseline: liquidations today come from a **single** `MIDAS_CCXT_EXCHANGE` (default Binance, whose public feed is gone → the default silently returns none, `ccxt.ts:408`). Do not assume a number — measure what the current feed returns on the `mock` provider and on one real venue that publishes liqs. 3. **Switch to `midas-honest-derivatives-campaign`** for the ranked solution menu, per-gate expected observations, fenced wrong paths (esp. "trust one exchange's liq feed"), and the promotion protocol. This skill's job ends at "here is the open problem"; the campaign owns execution. |
| **You have a result when…** | reported-vs-actual liquidation volume is **MEASURABLE across ≥2 venues** and each source's **staleness/throttle state is surfaced and verified correct** — proven by a test/measurement, never judged by eye. (The exact protocol and gates belong to the campaign; do not restate them here.) |

**Domain math** (what funding/OI/liquidations *mean*, units, which side a liquidated long is) is
owned by `crypto-market-reference` — do not re-derive it here.

### Problem 2 — 24/7 hosted alerts that fire without the user's box up

| Field | Content |
|---|---|
| **The open problem** | Deliver alerts reliably, per-user, from a shared self-hosted instance — so a trader gets the fire without keeping their own machine running. A reliability feature, not a paywall: Midas has no paid tier. |
| **Why current SOTA fails** | Self-hosted alerting dies when the user's box sleeps; the hosted incumbents gate always-on alerting behind steep tiers (Glassnode's API is $999/mo, `§3:88`). The gap prosumers actually feel is reliability + no-babysitting, not more alert types. |
| **Midas's specific asset** | The alerting spine is already wired: `apps/server/src/alerts/engine.ts` (evaluation loop), `alerts/notify.ts` `WebhookNotifier` (delivery), plus one-click alert templates already shipped (`ROADMAP.md` week 3). Delivery is honesty-aware — fires carry a `synthetic` flag so a mock-fed alert is never dressed as live (`alerts/notify.ts:47`). |
| **The honest gap** | It is **not per-user yet**. Delivery today is a single operator-scoped webhook (`MIDAS_ALERT_WEBHOOK`); "the digest is operator-only until per-user webhooks exist" (`ROADMAP.md:81`), and per-user webhooks/digests are an explicit roadmap-v3 item (`ROADMAP.md:86`). Under multi-user auth no loop evaluates account-metric alerts yet — "per-user account-alert evaluation is a planned follow-up" (`alerts/engine.ts`, ~line 57). So this capability is *scaffolded, not delivered*. |
| **First 3 steps IN THIS REPO** | 1. Read `alerts/engine.ts` + `alerts/notify.ts` to see how the global loop evaluates and delivers today, and confirm delivery is single-webhook, not per-user. 2. **Define "reliable" as a measurable SLA before building anything**: fire-to-deliver latency, missed-fire rate, duplicate-fire rate over a measured window on the `mock` provider (never a live exchange, never a real webhook — `midas-change-control`). Establish that baseline first; do not assume it works. 3. Take any per-user-webhook or reliability change through `midas-change-control` as a single-concern PR with a failing→passing test (evidence bar in `midas-validation-and-qa`). |
| **You have a result when…** | on the `mock` provider over a measured window, alerts fire and deliver **per-user** within a stated latency bound with **zero missed and zero duplicate** deliveries, and that number is reproduced by a test — asserted by measurement, not by confidence. |

### Problem 3 — Durable multi-user self-hosting (the DB-adapter seam)

| Field | Content |
|---|---|
| **The open problem** | Let one operator run a **shared multi-user instance** durably — surviving restarts, concurrent writers, and more than a handful of users — **without breaking self-host-free-forever or adding any paid tier**. |
| **Why it is hard / SOTA gap** | Today Midas leans single-tenant: first-user-only admin signup and file-backed JSON stores (`2026-strategy §2:64`). The per-user machinery already exists (encrypted keys, isolated provider clients, per-user loops), but each repo is a single-writer JSON file, so a busy shared box risks write contention and a large blast radius on the store. The frontier is a persistence layer that scales past one small box while staying invisible — and free — to a solo self-hoster. |
| **Midas's specific asset** | Every repo is file-backed JSON behind a documented **DB-adapter seam** — the docs state a deployment "swaps the file for its DB adapter later" (`HOSTED_KEYS_DESIGN.md:40-41`, `keys/repo.ts:7`) — so the swap point is already isolated behind one interface. `writeFileAtomic` (temp→fsync→rename) is the current durability primitive (`apps/server/src/persist.ts`). A pre-invite **smoke gate** (`scripts/smoke-hosted.mjs`) already asserts auth-enforced, secrets-never-returned, execution-held (`HOSTED_GO_LIVE.md §3`). |
| **First 3 steps IN THIS REPO** | 1. Read `HOSTED_KEYS_DESIGN.md:40-41` + `keys/repo.ts:7` to see the exact repo interface a DB adapter must satisfy. 2. Establish the baseline: on the `mock` provider, load-test a shared box (`scripts/loadtest.mjs`, `HOSTED_BETA.md §3`) and measure where the file-backed stores start to hurt — do not assume a number. 3. Route any persistence change through `midas-change-control` as a single-concern PR that keeps file-backed as the default for self-hosters and adds the DB adapter behind the same interface. |
| **You have a result when…** | a shared instance runs on a durable store behind the **same repo interface**, a solo self-hoster still gets the file-backed default with **every feature free**, and both paths are covered by passing tests — proven by measurement, never by eye. |

> **CANDIDATE — the database engine.** The committed docs name only "its DB adapter later"
> (`HOSTED_KEYS_DESIGN.md:40-41`); **no specific engine (e.g. Postgres) appears anywhere in the
> repo** (verified 2026-07-19). Treat a specific database as a CANDIDATE target, not a committed
> decision — the seam is real, the engine choice is not yet made in the repo.

---

## Part 2 — External positioning

### The thesis in one paragraph (all cited)

Midas is **free and open source under AGPL-3.0-only** — the whole terminal, every panel and
board and alert, self-hostable and full-featured with **no paid tier, subscription, or hosted
business** (`README.md`, `VISION.md`, `ROADMAP.md:95` invariant #4). It is a personal project
built in the open; an optional **shared multi-user instance** is just another way to self-host,
still free. The differentiator is **trust, not revenue**: honest data labeling and non-custody
are a reputation, not a lever to gate. Precedent that free-and-open works at scale: **OpenBB**
(AGPLv3, ~70k stars) shows an open-source data terminal can win real mindshare. The defensible
corner is **command-driven × crypto-native × self-hosted** — "no incumbent occupies all three"
(`VISION.md:31`).

### Why AGPL-3.0-only (the license is the strategy)

- **Verified:** AGPL-3.0-only in `LICENSE:1-2` (full AGPLv3 text) and in **all four** package
  manifests (`package.json`, `apps/web`, `apps/server`, `packages/shared`). The only "MIT" in the
  repo describes **CCXT** (a dependency), never Midas.
- **The logic:** AGPL keeps hosted *modifications* available to the users who run them, so the
  moat is deliberately **"hosted service + brand + community, not code alone"** (`2026-strategy
  §7 X1`, `§9`). Self-host-free-forever is a **standing non-negotiable invariant**
  (`ROADMAP.md:95` #4) — a positioning claim you may always make because it is contractually
  enforced, not a promise.
- **Guardrail:** never describe Midas as MIT or "source-available"; never propose a license change
  as part of a feature — that is a human/legal decision (`midas-change-control`).

### NOVEL vs KNOWN vs MUST-BE-PROVEN

The single most important positioning discipline: **be precise about what is genuinely
differentiated, what is commodity, and what you may not claim yet.**

| Claim | Status | Basis / what it would take |
|---|---|---|
| Honest, **source/staleness/throttling-labeled** cross-exchange derivatives & liquidations | **NOVEL — but CANDIDATE until built** | The *angle* is defensible: "nobody is honest about this" (`§4:111`). The *asset* exists (Problem 1). The *result* does not yet — liqs are single-exchange today. You may say "we are building honest-labeled cross-exchange derivatives"; you may **not** yet say "we have them" until Problem 1's milestone is met. |
| Command-driven × crypto-native × self-hosted, all three at once | **NOVEL (positioning)** | `VISION.md:31` "no incumbent occupies all three." Safe to state as positioning. |
| No-lock-in / own-your-keys / no-surprise-billing vs TradingView's trust gap | **NOVEL (positioning)** | `2026-strategy §5:128`, `§4`. Safe as a values claim; keep it about ownership, not a feature comparison table. |
| Multi-exchange market **data access** | **KNOWN — commodity** | CCXT (MIT) "collapses the crypto data moat: one integration → ~105 exchanges" (`VISION.md:26`); CoinGlass already aggregates (`§3:80`). Access is table stakes; the *honesty layer* is the wedge, not the access. |
| Indicator / analytics boards (the ~115) | **KNOWN — commodity** | "the least defensible surface… any charting tool clones one in a day" (`§1:19-21`, `§2`). The roadmap says **STOP** building these (`§7 STOP`). Never position breadth as the moat. |
| AI copilot | **KNOWN — parity** | "OpenBB has Claude too" (`§2:45`). Parity, not differentiation. |
| Charting | **KNOWN — lost** | "TradingView owns this" (`§2:48`). |
| "More accurate than exchange feeds" / "recovers the 6–20× gap" | **MUST BE PROVEN** | Requires the reported-vs-actual measurement from Problem 1. Do not claim accuracy or a recovery factor until measured. |
| Hosted-alert reliability / any SLA | **MUST BE PROVEN** | Requires Problem 2's measured latency/missed/duplicate numbers. No SLA language before measurement. |
| Any performance / scale / "runs N users" number | **MUST BE PROVEN** | Measure with `scripts/loadtest.mjs` first (`HOSTED_BETA.md §3`); never state a capacity number you have not run. |

### Reproducibility & claim standards (how to make a claim honestly)

Apply these before any external number, comparison, or "beyond SOTA" line goes out:

1. **Cite the roadmap for strategy; cite code for capability.** A capability claim ("we label
   staleness") must point to code or a test, not to a doc that merely aspires to it.
2. **Label unproven ideas OPEN or CANDIDATE.** If it is not built and measured, it is not a fact.
   Downgrade freely; never upgrade a CANDIDATE to fact to make a sentence sound better.
3. **Do NOT cite the killed claims.** The strategy pass adversarially verified 25 claims (21
   confirmed, 4 killed). **Never repeat:** CoinGlass "$12/mo premium"; TradingView "misflags
   retail as pro, no review"; Axiom "43% rebate" (`§4:97-98`). Treat "thin/unverified" items
   (Gödel deep pricing, mid-tier derivatives tools, direct Reddit/X voice-of-customer) as
   *unanswered, not absent* — do not launder them into evidence.
4. **Pricing and competitor facts are time-sensitive — re-verify before acting** (`§header:9`).
   A 2026 price is not a 2027 fact.
5. **Generated prose is not evidence.** A confident paragraph cannot stand in for a reproducible
   test, a source-backed data contract, or a measured number (`AI-DEVELOPMENT.md:28-31`).
6. **Demos stay honest.** Any screenshot/demo backing a claim uses the deterministic,
   credential-free reviewer demo or the `mock` provider — never real keys or hosted state to
   "look live" (`SECURITY.md:73-75`; owned by `midas-validation-and-qa`).

---

## When NOT to use this skill

| If you need… | Use instead |
|---|---|
| To actually EXECUTE the honest cross-exchange derivatives work (ranked options, gates, commands) | `midas-honest-derivatives-campaign` |
| What funding / OI / liquidations mean, units, formulas, which side a liquidated long is | `crypto-market-reference` |
| The provenance labeling mechanics (live vs streamLive vs SIM, the labeling checklist) | `midas-data-honesty-and-provenance` |
| To actually PROVE a "must be proven" claim — measurement recipes, the evidence bar, adversarial verification | `midas-proof-and-analysis` |
| Whether a change may ship / how to branch, test, PR, and promote | `midas-change-control` |
| House writing style, doc-of-record, single-sourcing versions | `midas-docs-and-writing` |
| An env var's default / where it is read (`MIDAS_CCXT_EXCHANGE`, `MIDAS_ALERT_WEBHOOK`, `MIDAS_KEYS_KMS_SECRET`) | `midas-config-and-flags` |
| To deploy/operate a hosted box (nginx topology, the `.env` posture, smoke gate) | `midas-run-and-operate` |
| The invariants and the monorepo/DataProvider design | `midas-architecture-contract` |

This skill is for **strategy and positioning questions**. The moment the task becomes a concrete
code change, promotion, or measurement protocol, hand off to the skill above and follow its gates.

---

## Provenance and maintenance

Date-stamped **2026-07-19**. Re-verify volatile facts before relying on them; run the paired
command from the repo root.

| Fact (as stated above) | Re-verify |
|---|---|
| License is AGPL-3.0-only across LICENSE + all 4 manifests | `head -2 LICENSE; grep -rl '"license": "AGPL-3.0-only"' --include=package.json .` (expect 4 files) |
| Forward "beyond SOTA" thesis, white space, roadmap, pricing ladder, killed claims | `sed -n '105,223p' docs/research/2026-strategy-and-roadmap.md` |
| Free-and-open-source standing invariant (#4); per-user-webhooks gap | `sed -n '83,96p' docs/ROADMAP.md` |
| Liquidations honesty note + single-exchange no-op already in code | `sed -n '405,420p' apps/server/src/providers/ccxt.ts` |
| Cross-venue fan-out seam (the aggregation the frontier extends) | `grep -n 'registerVenueBoard\|getVenueDerivatives' apps/server/src/routes/market.ts` |
| Alert engine + webhook delivery spine; per-user is a planned follow-up | `ls apps/server/src/alerts/; grep -n 'planned follow-up\|per-user' apps/server/src/alerts/engine.ts` |
| DB-adapter seam (the persistence swap point); pre-invite smoke gate | `grep -n 'DB adapter' docs/HOSTED_KEYS_DESIGN.md; grep -n 'smoke-hosted' docs/HOSTED_GO_LIVE.md` |
| DB-adapter seam is the ONLY committed persistence-swap statement; **"Postgres" is nowhere** | `grep -n 'DB adapter' docs/HOSTED_KEYS_DESIGN.md; grep -rin 'postgres' apps docs packages \|\| echo 'NONE — Postgres is CANDIDATE'` |
| No paid-tier/pricing language remains in the product docs | `grep -rn '\$20\|\$49\|waitlist\|Stripe' README.md docs/*.md \|\| echo 'clean'` |
| OpenBB / Axiom / competitor precedents & the "nobody is honest" wedge | `sed -n '70,131p' docs/research/2026-strategy-and-roadmap.md` |

**Counts caveat:** figures like "56% of 207 commands are indicator boards" or "~115 boards" come
from `2026-strategy §1-2` and **vary by document** (the code registry counts differently). Cite
them as the *strategy doc's* figures for positioning; for an exact live count, count the registry
(owned by `midas-architecture-contract`), do not quote a doc number as code truth.

**Ownership reminder:** if a fact here is a drift-prone number owned by another skill (env
defaults → `midas-config-and-flags`; command counts / invariants → `midas-architecture-contract`;
the six gates → `midas-validation-and-qa`), this skill cites the source and defers — it does not
become a second home for that number.
