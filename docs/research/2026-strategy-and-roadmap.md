# Midas — Strategy & Roadmap (mid-2026)

> Synthesis of (a) a grounded inventory of the product as-built, (b) a verified
> deep-research pass on the 2024–2026 crypto-terminal market (107 research
> agents, 25 sources, 25 claims adversarially verified → 21 confirmed, 4
> killed), and (c) the two prior Gödel dossiers in this folder. Decided posture:
> **open-core** (free self-hostable core + hosted tier & premium features),
> targeting **prosumer crypto traders**. Confidence is labelled throughout;
> pricing is time-sensitive (re-verify before acting).

---

## 1. Executive summary

Midas is, by raw feature count, already **past Gödel's crypto** (Gödel is L1-only,
no crypto screener, no funding/OI/liqs, no AI) and overlaps much of **CoinGlass's**
surface. The problem is **allocation, not effort**:

- **56% of the 207 commands are technical-indicator boards** — the *least*
  defensible surface (any charting tool clones one in a day).
- **Only ~7% is the crypto-native data core** (order book/DOM, funding, OI,
  liquidations, multi-exchange) — the actual moat — and parts of it are **thin**
  (single-exchange screeners; a liquidations feed that silently no-ops on the
  default exchange).
- The market moved underneath the original thesis: in 2024–2026 prosumers
  flocked to **hosted, execution-integrated, no-setup** terminals at massive
  scale (Axiom: ~$200M revenue in 202 days). This pressures two load-bearing
  Midas assumptions — **"no execution"** and **"self-host is the moat."**

**The roadmap therefore: stop the indicator treadmill; deepen and *harden* the
crypto-native moat (where CoinGlass is the bar and liquidation-data honesty is a
real wedge); build the open-core hosted tier (the answer to "prosumers won't
self-host"); and make a *deliberate* call on execution rather than leaving "no"
as an unexamined default.**

---

## 2. What we've built — honest inventory

| Category | ~Commands | Share | Moat? |
|---|---|---|---|
| Technical-indicator / screener boards | ~115 | **56%** | ❌ low (commodity) |
| Portfolio / risk / quant / optimizers | ~42 | 20% | ⚠️ medium, but **paper-only** |
| **Market data / order book / crypto-derivatives** | **~14** | **7%** | ✅ **the moat** |
| AI copilot & misc | ~16 | 7% | ⚠️ parity (OpenBB has Claude too) |
| Workspace / productivity / admin | ~11 | 5% | ✅ keyboard UX is real |
| Charting | ~9 | 4% | ❌ TradingView owns this |

**Genuinely wired (verified in code):** CCXT multi-exchange data; CCXT-Pro
WebSocket streaming (trades/book/ticker) with synthetic fallback; AI copilot
(real Anthropic calls, grounded in live data); server-side alerts + webhook
delivery; JWT auth + per-user persistence; **panel-linking link-groups exist**
(colored sync).

**Thin / structural gaps:**
- **Single-exchange** — screeners/boards run on one `MIDAS_CCXT_EXCHANGE`
  (default Binance); **no cross-exchange aggregation** (CoinGlass's table stake).
- **Liquidations are structurally thin** — they depend on CCXT `fetchLiquidations`
  and silently no-op (`// public liquidations feed not available`) where the
  exchange has no public feed; on Binance (default) that feed was throttled/removed
  in 2021. The headline crypto feature inherits the category's worst data problem.
- **Portfolio is paper-only** — no streaming price→P&L loop, no broker link.
- **No on-chain / DEX** surface at all (spot + perps only).
- **Not SaaS-grade** — single-tenant, first-user-only signup, no metering.

**Absent by design:** order execution; options/vol surface.

---

## 3. The market (cited)

**Five clusters.** (●=verified this pass, ○=from prior repo dossier / softer signal)

- **Open-core / command terminals** — ● **OpenBB** (AGPLv3, pip-installable,
  self-hostable, **~70k stars**) is the strongest precedent and proof of the
  exact model we picked: free OSS core *for "analysts, quants and AI agents"* +
  paid enterprise **Workspace** tier (RBAC/SSO/VPC/on-prem, seat-based). ○ **Gödel**
  ($118/mo · $996/yr) is equities-first; its crypto is L1-only with no screener,
  no funding/OI/liqs, no AI — Midas already exceeds it there.
- **Derivatives / flow analytics** — ● **CoinGlass** is the **most direct overlap**:
  multi-exchange derivatives/options/spot, **L2/L3 book**, liquidation **heatmaps**,
  OI, funding, indicators. The "liquidation-tracker" category defines table stakes:
  **cross-exchange aggregation, real-time, heatmaps, history**. ○ Coinalyze, Velo,
  Laevitas, Tensorcharts, Bookmap-crypto, Coinigy — not independently verified this
  pass (a known gap).
- **On-chain intel** — ● **Nansen** (Free + single **Pro $49/mo annual, $69/mo**),
  ● **Glassnode** (free Standard → **Advanced ~$26–49** → **Professional $999/mo**;
  **API gated to the top tier**). Both fully-hosted SaaS, no self-host.
- **Charting** — ● **TradingView** dominant but carries a **documented billing /
  cancellation / support trust gap** (charged after cancel, no-reply invoices,
  chatbot-only support) — a real *ownership / no-lock-in* wedge.
- **DEX/memecoin execution terminals** — ● **Axiom**: **$200M revenue in 202 days**
  (fastest Solana app ever), **~57% Solana-bot share** by mid-2025, by bundling
  discovery + sentiment + perps + yield + **sub-0.4s execution** into one **hosted,
  non-custodial** app. The dominant prosumer-behavior signal of the era.

**Killed claims (do not cite):** CoinGlass "$12/mo premium"; TradingView
"misflags retail as pro, no review"; Axiom "43% rebate." **Thin/unverified:**
Gödel pricing tiers beyond headline, the mid-tier derivatives tools, the on-chain
set beyond Nansen/Glassnode, and direct Reddit/X voice-of-customer (the harness
killed weak sources — treat these as *unanswered, not absent*).

---

## 4. What customers wish they had (signal)

- **Reliable liquidation/flow data** — the category's open secret is that exchange
  liq WebSockets are throttled to ~1/sec and **underreport 6–20×** (Bybit's CEO:
  $2.1B internal vs $333M shown; feeds "unreliable since 2021"). Traders treat
  liq clusters as leading signals yet can't trust the numbers. **Nobody is honest
  about this.**
- **No surprise billing / lock-in** — the loudest TradingView gripe is commercial
  trust, not features.
- **One surface, not ten tabs** — the winning DEX terminals collapsed discovery +
  data + (execution) into a single fast app; prosumers reward consolidation.
- **Ownership & no-API-key access** — OpenBB's traction + Midas's CCXT approach
  both point to demand for "your data, no key gymnastics" (Glassnode gating API to
  $999 is the anti-pattern).

---

## 5. White space Midas is best positioned to win

1. **The honest, cross-exchange derivatives terminal.** Aggregate funding/OI/liqs
   across venues, **label source + staleness + known-throttling**, add heatmaps +
   history. Turns the category's dirty secret into a trust differentiator *and*
   fixes Midas's own thin liq feed.
2. **Keyboard-first ownership play vs TradingView's trust gap** — "own your stack,
   own your keys, no surprise billing, no lock-in."
3. **Open-core hosted convenience** — OpenBB proves the model; the hosted tier is
   the answer to "prosumers won't self-host" without abandoning the OSS moat.

---

## 6. The hard forks (the "shift gears" questions)

**(A) Execution.** *Every* breakout prosumer terminal in the verified set monetizes
via **execution**; analytics-only tools monetize via subscriptions at far smaller
scale. "No execution" was a reasonable v1 non-goal but is now a **strategic choice
to revisit**, not a default. → *Recommendation:* keep the core analytics-only, but
plan an **optional, keys-required, non-custodial execution module on the hosted
tier** ("own your keys" fits the brand and is where engagement + revenue live).
**This needs your explicit buy-in — it's the biggest pivot on the table.**

**(B) Self-host vs hosted.** No verified data quantifies self-host *demand*; the only
hard behavioral signal (Axiom) shows prosumers choosing **hosted convenience**. →
Don't bet the company on self-host preference. Keep self-host as the **brand/trust
anchor and free tier**, but make **hosted the default on-ramp**.

---

## 7. Roadmap

### NOW — harden the moat, stop the bleed (≈4–8 wks)
- **N1. Freeze the indicator treadmill.** Declare TA coverage complete. Collapse the
  ~115 board commands into **one unified, searchable Screener** (pick metric, multi-
  sort) — less surface, better UX, frees all effort. *(improve, not add)*
- **N2. Cross-exchange aggregation** for funding/OI/liqs + screeners (today: single
  `MIDAS_CCXT_EXCHANGE`). The CoinGlass table stake and a real current gap.
- **N3. Honest liquidations** — multi-source aggregation, a **liq heatmap + history**,
  and explicit **data-source / staleness / confidence labels**. The trust wedge.
- **N4. Data-honesty layer** — productize VISION's "honest data" principle: per-feed
  real-time / delayed / unavailable badges everywhere.

### NEXT — commercial layer + stickiness (≈2–4 mo)
- **X1. Hosted Midas (open-core tier)** — one-click managed instance; OSS core stays
  AGPL-3.0-only. The business begins here while hosted improvements remain
  available to the users who run them.
- **X2. Stickiness > indicators** — rock-solid **alerts → action**, **saved/shareable
  scans**, 24/7 hosted alerts that fire without the user keeping a box up (the
  natural premium lever, à la Glassnode gating).
- **X3. On-chain / DEX read layer (lite)** — token discovery, wallet/flow watch, DEX
  screeners via free public sources. Closes the spot+perps-only credibility gap and
  meets prosumers where they actually are — **no custody, no execution** yet.

### LATER — deliberate big bets
- **L1. Execution fork** (see §6A) — optional, keys-required, non-custodial, hosted-
  tier. *Decision required.*
- **L2. Network effects** — lightweight shared sentiment / shared workspaces / shared
  scans (Gödel's stickiest moat is community).

### STOP
- Building individual indicator boards — marginal strategic value ≈ 0.
- Breadth-for-breadth's-sake anywhere.

---

## 8. Pricing (hosted tier sizing)

Benchmarks: Gödel **$118/mo · $996/yr**; Nansen Pro **$49–69/mo**; Glassnode
**Advanced ~$26–49**, **Pro $999**; CoinGlass free + paid; OpenBB free OSS + seat-
based enterprise. Prosumer sweet spot is **sub-$50/mo**.

| Tier | Price | What |
|---|---|---|
| **Self-host (OSS, AGPL-3.0-only)** | Free | Full core; own your stack |
| **Hosted Free** | $0 | Managed instance, basic real-time, capped alerts |
| **Pro** | **~$19–39/mo** | Multi-exchange real-time, 24/7 hosted alerts, history depth, on-chain lite |
| **Team / Pro+** | ~$99+/mo | Shared workspaces, seats, priority data |

---

## 9. Risks

- **Execution gravity** — analytics-only may cap prosumer wallet-share; mitigate via
  on-chain read layer (X3) then optional execution (L1).
- **Self-host-as-moat unproven** — hosted tier de-risks; don't over-index on it.
- **License adoption friction** — AGPL keeps hosted improvements available but can
  narrow proprietary embedding; the moat must still be **hosted service + brand +
  community**, not code alone.
- **Liquidation-data unreliability** — surfaced naively it erodes trust; the honesty
  layer (N3) flips it into a strength.
- **CoinGlass mindshare** — differentiate on keyboard UX + ownership + honesty, not
  feature parity.

---

## 10. Bottom line

Don't add the 116th indicator. **Convert breadth into a hardened, honest,
cross-exchange crypto-data terminal, wrap it in an open-core hosted business, and
make a real decision on execution.** That's the path from "impressive feature
count" to "tool prosumers depend on daily — and pay for."
