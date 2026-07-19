---
name: midas-proof-and-analysis
description: >-
  The "prove it, don't eyeball it" discipline of Midas — the evidence bar, the
  measurement recipes, and the adversarial-verification method that turns a hunch
  into an accepted result. Load this when you must PROVE a claim rather than
  assert it: "is this actually fixed?", "prove the cache is bounded", "reproduce
  this race", "prove the stream releases its slot", "prove this feed is labelled
  honestly", "measure the bundle delta", "what counts as evidence here", "the
  tests pass but is it really right?", "write the failing test first", "the
  hypothesis should predict the number", "adversarially verify this", "spawn
  skeptics to refute this finding", "green suite but I suspect a bug", "one
  mechanism must explain all the observations". Owns the evidence standard
  ("generated prose is not evidence"), five worked analysis recipes grounded in
  real commits, and the refutation protocol. NOT the tools themselves
  (midas-diagnostics-and-tooling), NOT symptom triage (midas-debugging-playbook),
  NOT the gate definitions (midas-validation-and-qa), NOT the merge/acceptance
  gate (midas-change-control).
---

# midas-proof-and-analysis

**The rule of this repo: a confident explanation is not a result.** A claim is
accepted only when a reproducible artifact forces it to be true — a failing test
that now passes, a measured number that matches a number you predicted first, a
counterexample nobody could produce. This skill is the METHOD: the bar a claim
must clear, the recipes for producing the artifact per bug class, and the
adversarial pass you run when the green suite is not enough.

Use it whenever you are about to write the words "fixed", "safe", "works",
"bounded", "honest", or "no leak". Those words are claims. This skill is how you
earn them.

**Term definitions** (used throughout): a **finding** = a specific falsifiable
statement ("`POST /api/orders` returns 503 unconditionally"; "the TTL cache
cannot grow past 500 keys"). A **discriminating experiment** = a test whose
result differs depending on whether the finding is true — it *fails on the old
code and passes on the new*. **Provenance** = Midas's `live | synthetic |
unavailable` honesty label (mechanics owned by `midas-data-honesty-and-provenance`).

---

## 1. The evidence bar — five tests every claim must pass

Source of record: `docs/AI-DEVELOPMENT.md` (the "Evidence standard", lines
18–31). The load-bearing sentence, verbatim (`AI-DEVELOPMENT.md:29-31`):

> **Generated prose is not evidence.** A confident explanation cannot replace a
> reproducible test, a source-backed data contract, a security assertion, or a
> manual artifact from the environment that actually matters.

Run a claim through all five tests. If it fails any one, it is a hunch, not a
result — keep working or label it `OPEN`.

| # | Test | What it rejects | Worked example (real commit) |
|---|------|-----------------|------------------------------|
| 1 | **Prose is not evidence.** The artifact is a test, a measured number, or a source-backed contract — never an explanation of why it should be fine. | "I reasoned through it, it's correct." | The whole repo: every fix below ships a *test*, not a paragraph. `AI-DEVELOPMENT.md:18-31`. |
| 2 | **One mechanism explains ALL observations — including the negatives.** A hypothesis that explains the bug but hand-waves why the *unaffected* cases were fine is unproven. | Cherry-picking the confirming case. | `0c50ef2`: mechanism = "non-live provider fires alerts on synthetic random-walk". It explains why price/change/funding deliveries were mislabelled AND the negative — equity/upnl were *never* mislabelled "because they only ever fire on live data". Both facts fall out of one mechanism. |
| 3 | **The hypothesis predicts the number BEFORE you run it.** Write the expected value/label/count down first; then measure. A number you only explain after seeing it proves nothing. | Retro-fitting the theory to whatever the run printed. | `0a48481`: the mechanism predicts the *exact* failing input up front — `JSON.stringify({value: NaN})` serialises to `{"value":null}`, `Number(null) === 0`, so a `value:0` alert is minted. The test asserts that precise path *before* the fix lands. |
| 4 | **Every behavioural fix ships a failing→passing test.** The test must fail on the old code and pass on the new. If you cannot write one, question whether it is a bug. | "Fixed" with no regression test. | Rule owned by `midas-change-control` (`REFACTOR_PLAYBOOK.md:111-114`). Recipes §2 show how to build one per bug class. |
| 5 | **The six gates are necessary, not sufficient.** A green suite is the floor, not the ceiling — it proves only what someone already thought to test. | "All tests pass, therefore correct / launch-ready." | `811626f` shipped green with its own regression tests; an adversarial pass then found a real bug those tests never exercised → `f3e2eee`. See §3. |

The six gates themselves (typecheck · server tests · web tests · web prod build ·
bundle budget · static-demo build, plus `test:reviewer` in CI) are defined and
maintained by **`midas-validation-and-qa`** — this skill treats them as the
mandatory floor and adds what floor-passing cannot give you.

**"Not tested and why."** Step 5 of the evidence standard (`AI-DEVELOPMENT.md:26`)
is mandatory: state explicitly what you did NOT prove. Web components cannot be
rendered (the web test env has no DOM — see `midas-validation-and-qa`), so
"verified by typecheck + reasoning, not by rendering" is an honest, required
disclosure, not a failure.

---

## 2. The analysis recipes

Five recipes, one per proof-shape that recurs in this repo. Each is: **the claim →
the mechanism → the discriminating experiment → the number/assertion**, grounded
in a real commit and test you can open. To decide *which* recipe a symptom needs,
first triage with **`midas-debugging-playbook`**; this skill is how you PROVE the
claim once you know its shape.

Run any focused proof with (verified 2026-07-19, from repo root):

```bash
npx vitest run --root apps/server src/ttlCache.test.ts        # one file
npx vitest run --root apps/server src/streaming.test.ts -t fatal  # one describe/it
```

(Canonical focused-test form → `midas-validation-and-qa`; the `--root` form above and the
`-t` form both filter correctly — verified 2026-07-19. Deeper tooling → `midas-diagnostics-and-tooling`.)

### Recipe index

| Recipe | Claim you are proving | Worked example |
|--------|-----------------------|----------------|
| R1 Provenance | "This surface is labelled honestly — synthetic is never shown as live." | `8a2622b`, `0c50ef2` |
| R2 Race / TOCTOU | "Concurrent actions during an async gap are not lost or resurrected." | `4aca668` |
| R3 Cache bound | "This per-tenant/per-key store cannot grow without limit." | `0a48481` |
| R4 Stream teardown | "A dead/stopped stream releases every resource it held." | `811626f`, `f3e2eee` |
| R5 Bundle delta | "This change moves the bundle by exactly N KB (often 0)." | `check-bundle.mjs` |

---

### R1 — Prove a provenance claim

**Claim shape:** "surface X reports `live`/`SIM`/`synthetic` correctly across
providers." **The trap:** `live` (REST-quote liveness) and `streamLive` (WS
liveness) are *deliberately separate* — a green test on the REST label does NOT
prove the socket badge is honest. Proof requires driving the SAME surface through
a live and a non-live source and asserting the label *flips*.

**Mechanism (worked example `8a2622b`):** the WS stream falls back to a synthetic
random-walk for every non-ccxt provider, but the badge showed "LIVE" on any open
socket. `providerStreamsLive()` (`apps/server/src/streaming.ts:52`) is the single
source of truth; `/api/health` exposes it as `streamLive`
(`apps/server/src/routes/market.ts:103`); the badge maps `streamLive:false → "SIM"`
(`apps/web/src/lib/streamStatus.ts:31-34`, tone `'simulated'`).

**Discriminating experiment** — assert the label per liveness state, both ways
(from `notify.test.ts:60-74`, the `0c50ef2` delivery-honesty case):

```ts
// non-live provider → the delivery is FLAGGED and carries the notice
const p = buildWebhookPayload([trg()], /* synthetic */ true);
expect(p.synthetic).toBe(true);
expect(p.content.split('\n')[0]).toMatch(/SYNTHETIC/i);
// live provider (default arg) → NOT flagged  (this is the negative that test #2 demands)
expect(buildWebhookPayload([trg()]).synthetic).toBe(false);
```

**The assertion is the proof:** the label is a pure function of a liveness input,
and the test pins both the positive (synthetic → flagged) and the negative (live →
not flagged). A test that only checks the live path would pass over a mislabelled
mock — exactly the recurring #1 bug class. Union/labelling-checklist mechanics live
in **`midas-data-honesty-and-provenance`**; this recipe is only how you PROVE a
given surface obeys them.

### R2 — Reproduce a race (TOCTOU / stale-snapshot)

**Claim shape:** "an action landing during an async gap is not lost or undone."
**Key technique:** you do NOT need real threads. Node is single-threaded — you
reproduce the race *deterministically* by hand-interleaving: capture the snapshot,
perform the concurrent mutations, THEN commit the stale snapshot.

**Mechanism (worked example `4aca668`):** `AlertRepo.commit()`
(`apps/server/src/alerts/repo.ts:156`) replaced the live list wholesale with
`next` — a snapshot taken *before* the eval pass's awaited provider reads. Any
create/delete/enable landing during those reads was silently reverted. Fix: merge
by id.

**Discriminating experiment** (`apps/server/src/alerts/repoCommit.test.ts:9-37`):

```ts
const snapshot = repo.all().map((x) => ({ ...x }));   // engine reads BEFORE await
const c = repo.create(input('SOL/USDT'), NOW);        // ← lands during the gap
repo.updateFor(a.id, { enabled: false });             // ← user disables A
repo.removeFor(b.id);                                  // ← user deletes B
repo.commit(snapshot.map((x) =>                        // engine commits STALE next
  x.id === a.id ? { ...x, status: 'triggered', lastValue: 123 } : x), []);

expect(byId.get(a.id)?.enabled).toBe(false);   // concurrent disable preserved…
expect(byId.get(a.id)?.status).toBe('triggered'); // …AND eval fields still applied
expect(byId.has(b.id)).toBe(false);   // deleted-in-gap stays deleted (no resurrection)
expect(byId.has(c.id)).toBe(true);    // created-in-gap survives (not dropped)
```

**Why it is a proof:** the test *fails on the old wholesale-replace code* (C is
dropped, B resurrected) and passes on merge-by-id. Predict all four outcomes
before running (test #3). Two of the five execution-hold retraction reasons were
races of exactly this shape — reserve/commit ordering (see
`midas-failure-archaeology`).

### R3 — Prove a cache/store eviction bound

**Claim shape:** "this Map/store keyed by user-controlled input cannot grow
without limit." **Key technique:** set a *tiny cap and a huge TTL* so nothing
expires — then only the size bound can keep the map small. Spray N ≫ cap distinct
keys and prove the oldest was evicted while the newest survived.

**Mechanism (worked example `0a48481`):** `createTtlCache` never evicted — a key
requested once lingered forever, so a junk-quote spray grew the Map unboundedly
(memory DoS on public fan-out routes). Fix: `prune()` drops expired entries then
evicts oldest-first past `DEFAULT_MAX_ENTRIES = 500`
(`apps/server/src/ttlCache.ts:22,66-82`).

**Discriminating experiment** (`apps/server/src/ttlCache.test.ts:64-85`):

```ts
const cache = createTtlCache<number>(10_000, () => 0, /* maxEntries */ 3); // huge TTL, cap 3
for (let i = 0; i < 50; i++) await cache.get(`k${i}`, async () => i);      // spray 50 keys
let oldRan = false;
await cache.get('k0',  async () => (oldRan = true, 0));
expect(oldRan).toBe(true);     // oldest was EVICTED → compute re-runs = proof of the bound
let newRan = false;
await cache.get('k49', async () => (newRan = true, 49));
expect(newRan).toBe(false);    // newest still cached → we bounded, we didn't just clear
```

**The compute-ran boolean is the observable** — you cannot see a Map's internals
in a black-box test, so you prove eviction indirectly: an evicted key *recomputes*,
a retained key does not. The pair (old recomputes, new does not) rules out both
"unbounded" and "flushes everything". This is bug class **D** (unbounded
per-tenant caches); the same shape proves `6b55d80`/`cb0bd8b` alert-store bounds.

### R4 — Prove a stream/socket teardown releases its resources

**Claim shape:** "when a stream stops or dies, every slot/quota/subscription it
held is released." **Key technique:** inject a *fake* `StreamSource` so you can
trigger the terminal event (stop, or a fatal `onFatal`) deterministically without
a live exchange, then prove the resource is free by showing it can be
*re-acquired*.

**Mechanism (worked examples `811626f` + `f3e2eee`):** `stop()` originally only
flipped `running=false` — it never told ccxt to `unWatch`, leaking the exchange
subscription + per-symbol cache. And a fatal `BadSymbol` freed the hub's global
source slot but left the WS route's per-socket `held` ledger + per-IP quota
charged (`apps/server/src/streaming.ts:363,405`), so the held-idempotency guard
*permanently* blocked that connection from rebuilding.

**Discriminating experiment** — drive the real message handler across a fatal
death; the source rebuilding on re-subscribe proves the ledger + quota were
released (`apps/server/src/streaming.test.ts`, the "through registerStream" case):

```ts
const injected: StreamSource = { start(_c,_s,_emit,onFatal){ startCalls++; reportFatal = onFatal; return () => {}; } };
const hub = createStreamHub(provider, 500, injected);   // inject the fake
registerStream(app, hub);                               // wire the REAL ws route
send({ type:'subscribe', channel:'trades', symbol:'JUNK/USDT' });
expect(startCalls).toBe(1);
reportFatal?.('gone');                                  // upstream dies permanently
send({ type:'subscribe', channel:'trades', symbol:'JUNK/USDT' });
expect(startCalls).toBe(2);   // rebuilt ⇒ held slot + IP quota were released. Old code: stuck at 1.
```

For the `unWatch`-on-stop half, assert the exchange call fired after `stop()`
(`ccxt-stream.test.ts`), remembering unwatch is deferred one microtask
(`await Promise.resolve()`) for sync-throw safety. Bug class **C**.

### R5 — Measure a bundle delta

**Claim shape:** "this change moves the web bundle by N KB" — most often the
prediction is **0** (a server-only change). **Method: predict, then measure.**

1. **Predict first (test #3).** Server/shared-logic-only change touching no file
   Vite bundles → predicted delta **0 bytes**. `811626f`/`f3e2eee` state "web
   bundle byte-identical" precisely because they touch only `apps/server/**`
   (confirm with `git show <sha> --stat` — no `apps/web` path).
2. **Measure.** `check-bundle.mjs` (`scripts/check-bundle.mjs`) gzips every JS
   chunk in `apps/web/dist/assets`; MAIN = `index-*` entry chunk, TOTAL = all
   chunks. The budget constants live at `check-bundle.mjs:17-18` — perf invariant
   #5, owned by **`midas-architecture-contract`** (don't restate the literals; read
   them live). Baseline **139.3 KB main / 615.4 KB total** gzip (2026-07-19, a
   measurement, not the budget). Must run **from repo root** and **after a build**
   (`dist/` is gitignored) — the tool mechanics/exit codes are owned by
   **`midas-diagnostics-and-tooling`**.
3. **Reconcile.** Measured delta ≠ predicted delta is itself a finding: a
   "server-only" change that moved the bundle imported something into web code —
   investigate before you trust the diff.

A new *eager* panel import breaks the lazy-load invariant and shows up here as
KB; panels must stay lazy (see `midas-architecture-contract`).

---

## 3. Adversarial verification — spawn skeptics to refute the finding

**Why this exists.** The six gates prove only what someone thought to test. In
this repo a green suite once masked a real medium bug: `811626f` (CCXT-Pro stream
lifecycle) shipped with passing regression tests, but an adversarial review of
that very change surfaced a bug its tests never exercised — `onFatal` freed the
hub slot yet left the socket's `held` ledger + IP quota charged, permanently
blocking rebuild. That became `f3e2eee` (both landed in PR #330). **The gates were
necessary and insufficient; the adversarial pass is what caught it.**

**The method.** For a finding or a "this change is correct and complete" claim,
spawn **N independent skeptics** (N = 3–6; use the `Agent` tool with
`subagent_type: general-purpose`, or N independent human/session reviewers), each
given the claim + the evidence and prompted **to REFUTE it** — not to review it.
Independence matters: do not let them see each other's conclusions.

**Refutation prompt template** (one per skeptic):

```
CLAIM: <the exact finding, e.g. "f3e2eee fully releases per-socket resources on
        a fatal stream death; no rebuild path stays blocked.">
EVIDENCE: <the failing→passing test + the file:line of the fix.>
YOUR JOB: Refute this. Find one concrete input, interleaving, provider state,
  tenant boundary, or restart that makes the claim FALSE. Produce a reproducing
  case (a test that fails), or state the single strongest reason it cannot be
  refuted. Do NOT agree to be helpful. A counterexample beats an opinion.
```

**Decision rule:**

- **Any skeptic that produces a reproducing counterexample kills the claim** —
  send it back. Refutation is asymmetric: one solid failing case is a proof; any
  number of "looks fine" is not.
- **Majority-refute kills the claim** even without a single clean repro — a
  majority independently smelling the same gap is a strong prior the finding is
  wrong or incomplete.
- **Accept only on unanimous "could not refute"** — and even then record it as
  "adversarially survived", not "proven absent". You cannot prove a negative;
  you can only fail to refute it after honest attack.

**When to run it (do not skip on these):** honesty/provenance labels; concurrency
& TOCTOU; stream/socket & other resource lifecycles; multi-tenant isolation;
anything touching `apps/server/src/keys/`, `auth/`, `trading.ts`, or the execution
hold. These are precisely the classes where the gates are historically blind
(the recurring bug classes — see `midas-debugging-playbook`).

**What adversarial verification is NOT:** it is not the acceptance/merge decision
(that is the six gates + human review, owned by **`midas-change-control`**), and
skeptics must attack falsifiable behaviour, not manufacture volume —
`AI-DEVELOPMENT.md:64-69`: "prioritize falsifiable correctness over volume …
should not manufacture issues to appear useful."

---

## When NOT to use this skill

| You need… | Use instead |
|-----------|-------------|
| The concrete tools/scripts (check-bundle, focused-vitest invocation, quota/stream introspection) | `midas-diagnostics-and-tooling` |
| To identify WHICH bug class a symptom is (triage) | `midas-debugging-playbook` |
| The definition of the six gates / reviewer demo / how-to-add-a-test / web-no-DOM | `midas-validation-and-qa` |
| The merge/acceptance gate & promotion protocol | `midas-change-control` |
| Provenance union + labelling checklist + demo↔server fidelity contract | `midas-data-honesty-and-provenance` |
| The settled history of battles already fought (the trading retraction, etc.) | `midas-failure-archaeology` |
| A measurable, decision-gated campaign for the hardest problem | `midas-honest-derivatives-campaign` |

This skill is the *method* (bar + recipes + refutation). The siblings own the
*tools*, the *triage*, the *gates*, and the *acceptance decision*.

---

## Provenance and maintenance

Every volatile fact below is date-stamped **2026-07-19** and paired with a
re-verification command. Re-run before trusting a number.

| Fact (as of 2026-07-19) | Re-verify |
|-------------------------|-----------|
| Evidence standard + "generated prose is not evidence" at `AI-DEVELOPMENT.md:18-31` | `sed -n '17,31p' docs/AI-DEVELOPMENT.md` |
| Adversarial story: `811626f` (fix) then `f3e2eee` ("a bug an adversarial review of that change surfaced"), both in PR #330 | `git show f3e2eee \| head -30` ; `git log --oneline --grep='stream'` |
| R1 provenance: `providerStreamsLive` `streaming.ts:52`; `streamLive` in `/api/health` `routes/market.ts:103`; SIM tone `streamStatus.ts:31` | `grep -n providerStreamsLive apps/server/src/streaming.ts apps/server/src/routes/market.ts` |
| R2 race: `AlertRepo.commit` merge-by-id `alerts/repo.ts:156`; proof `alerts/repoCommit.test.ts` | `npx vitest run --root apps/server src/alerts/repoCommit.test.ts` |
| R3 cache bound: `DEFAULT_MAX_ENTRIES = 500` `ttlCache.ts:22`; proof `ttlCache.test.ts:64` | `npx vitest run --root apps/server src/ttlCache.test.ts` |
| R4 stream teardown: held/quota release `streaming.ts:363,405`; proof `streaming.test.ts` + `ccxt-stream.test.ts` | `npx vitest run --root apps/server src/streaming.test.ts src/ccxt-stream.test.ts` |
| R5 bundle: budget constants `check-bundle.mjs:17-18` (invariant #5, owned by architecture-contract); baseline 139.3/615.4 KB gzip (a measurement) | `pnpm build && node scripts/check-bundle.mjs` (from repo root) |
| Failing→passing-test rule `REFACTOR_PLAYBOOK.md:111-114` (owned by change-control) | `sed -n '111,114p' REFACTOR_PLAYBOOK.md` |
| All five cited server test files pass (32 tests) | `npx vitest run --root apps/server src/notify.test.ts src/alerts/repoCommit.test.ts src/ttlCache.test.ts src/streaming.test.ts src/ccxt-stream.test.ts` |

**Drift watch:** commit SHAs are immutable, but `file:line` anchors move when
files are edited — if a line does not match, re-grep the symbol name (the recipes
name every symbol). The evidence *bar* and the *method* do not expire; only the
line numbers do.
