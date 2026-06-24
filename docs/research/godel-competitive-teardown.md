# Gödel Terminal — Competitive Teardown

_Research dossier informing Midas's positioning. Produced via a multi-agent deep-research
pass (106 agents, 24 sources, 25 claims adversarially verified — 22 confirmed, 3 killed),
2026-06-24. Confidence and caveats are noted throughout; treat vendor metrics as advertised,
not benchmarked._

---

## TL;DR

Gödel Terminal is a **web-native, keyboard-first Bloomberg-workflow clone for research
desks** — a backtick command palette + Bloomberg-style mnemonics over a movable
multi-panel workspace, with real-time multi-asset data at **~$996/seat/yr vs ~$30k
Bloomberg**. The pivotal finding: **Martin Shkreli is co-founder/owner of Gödel's parent
(DL Software)** — his YouTube "breakdowns" are owner marketing, not independent critique.
For a self-hosted, command-driven competitor, the data points decisively toward a
**crypto-native** wedge (CCXT removes the data moat) rather than competing head-on with
Gödel (equities desks) or OpenBB (open-source data breadth + AI agents).

---

## 1. Gödel's identity _(verified, high confidence)_

A **web-native, keyboard/CLI-driven Bloomberg-workflow clone.** Press `` ` `` anywhere to
open a command palette; type Bloomberg-style mnemonics in a `COMMAND TICKER [ASSETCLASS]`
pattern.

**Verified function mnemonics:** `DES` (company overview) · `FA` (financial analysis) ·
`FOCUS` (live quote) · `TAS` (time & sales) · `HDS` (institutional holders) · `MOST`
(most-active) · `N` / `TOP` (news) · `OPT` (options) · `HMS` · `EM`.

**Workspace UX:** a fully customizable **movable/resizable multi-panel** workspace (up to
~six panels as independent workspaces, cycle via Tab, pop panels out onto the native OS
desktop). It is a floating-window model, not strict auto-tiling.

**Data coverage:** real-time US quotes **direct from Nasdaq**, **TradingView** charting,
**EDGAR** filings rendered in-app (10-K, 10-Q, 8-K, S-1, proxies, 13Fs — sortable/filterable,
no tab-switching), standardized fundamentals (income statement / balance sheet / cash flow,
annual + quarterly, tied to filings), 13F ownership, sub-100ms news. Asset classes span
equities, ETFs, indices, FX, futures, options, bonds, and crypto across NA / Europe / APAC
(international equities rolling out ~Aug–Sep 2025).

**Pricing:** **$996/seat/year** (~$118/mo), pitched as saving ~$28k/yr/analyst vs a ~$30k
Bloomberg seat. _A specific "free + $80/mo Pro + $40/mo FINRA surcharge" tier structure was
**refuted 0-3** — exact tiers beyond the $996 headline are unconfirmed → a target for live recon._

**Delivery:** browser-native, no install/hardware (a thin Electron/WebCatalog wrapper exists).

**Identity in one line:** *Bloomberg muscle-memory in a browser, at ~3% of the price.*

---

## 2. The Shkreli reframe _(verified, high confidence)_

**Martin Shkreli is co-founder of DL Software, Gödel's parent company** (LinkedIn,
Crunchbase, PRNewswire "$2M pre-seed", Aug 2024; a ~$5M seed was referenced Jan 2026).
His YouTube content is **his own promotional / owner content**, pushed with a personal
affiliate discount code (`THESHKRELIPILL` / `SHKRELI`, ~30% off). He is also a convicted
securities fraudster. **Treat every "Shkreli breakdown" as vendor marketing, not critique.**

**Why his videos still matter to us:**
- As **product demos** they're the best footage of the *intended* workflow.
- The **brand narrative** is the strategic signal: *"Bloomberg is aging boomer tech; they
  personally banned me (a user since age 16, in 2000); so I built the modern replacement."*
  That founder-grievance, anti-incumbent story is core to Gödel's go-to-market.

**Cited videos / sources:**
- Demo (~Jun 2025): <https://www.youtube.com/watch?v=YhOdp87zwmk>
- "Bloomberg Terminal's New Rival Is FREE": <https://www.youtube.com/watch?v=kJ-uqLwThMg>
- COI / ownership context: <https://www.youtube.com/watch?v=dSNEJ8qVuwU>
- "boomer tech" / ban narrative (tweet, Mar 2024): <https://x.com/wagieeacc/status/1767965349377360019>

**Caveats:** the ban is **self-reported** (no Bloomberg/court/press corroboration); the
"Bloomberg banned *Gödel the product*" framing was **refuted 0-3** (the documented ban is
personal to Shkreli only). Lesson for Midas: **do not copy the grievance story — build our
own ("own your stack").**

---

## 3. Competitive landscape

Only OpenBB and CCXT cleared adversarial verification; the broader field
(Koyfin, TIKR, FinChat, AlphaSense, BamSEC, Thinknum, TradingView, etc.) is **directional and
needs a second verification pass** before relying on specifics.

| Player | What it is | Relevance to Midas | Confidence |
|---|---|---|---|
| **OpenBB** | Open-source (AGPLv3, ~70k★), `pip install`, Python/CLI-scriptable, FastAPI backend (`127.0.0.1:6900`), ships **MCP servers** "for analysts, quants and AI agents." Sunset its old terminal TUI. | **Already owns** open-source + self-hosted + dev-first + AI-agent-native. Don't fight there. AGPLv3 ⇒ can't embed in a closed Midas without copyleft. | High |
| **CCXT** | **MIT-licensed** unified API to ~105 crypto exchanges; **public market data needs no API keys**. | Collapses the crypto data moat to one integration, legally clean for a closed product. **Cornerstone of the crypto-native wedge.** | High |
| **Databento** | Real-time US equities with **zero exchange license fees** + redistribution rights. | The viable data path *if* Midas ever does equities — still heavier/licensed than crypto. | Directional |
| Koyfin / TIKR / TradingView / FinChat / … | Dashboards / charting / research SaaS. | None verified to own a **command-driven** or **crypto-native + command** niche. | Unverified |

---

## 4. Niche analysis & recommendation

| Candidate niche | Pros | Cons | Verdict |
|---|---|---|---|
| **Crypto-native, command-driven, self-hosted** | CCXT (MIT, no keys, 105 exchanges); no command-UX crypto incumbent; cheapest solo build; 24/7 global; dodges both Gödel & OpenBB | Smaller TAM than equities; crowded *dashboard* space (but not command-driven); crypto cyclicality | **★ Chosen wedge** |
| Equities prosumer (cheaper/self-host Gödel) | Biggest TAM; obvious demand | Data-licensing cost; head-to-head vs Gödel + Koyfin/TIKR | Hard for a small team |
| Dev/quant API-first + AI copilot | Fits the codebase; AI tailwind | OpenBB already owns it (AGPLv3 + MCP) | Contested |
| Self-hosted / privacy-first generalist | Real differentiator vs cloud SaaS | OpenBB self-hosts too; "privacy" alone is thin | Supporting angle |

**Recommendation (medium confidence — analytical judgment):** make Midas the
**command-driven, self-hosted, crypto-native terminal**. It's the one wedge where a solo
builder has structural advantages over both a funded startup (Gödel) and a 70k-star OSS
project (OpenBB). Keep the **AI copilot as a feature**, and use **self-hosted / own-your-keys**
as the brand story. → adopted in [`VISION.md`](../../VISION.md).

---

## 5. Caveats & confidence

- **Source access:** godelterminal.com, its docs, and YouTube returned **HTTP 403** to direct
  fetches (proxy/Cloudflare bot blocks). Gödel/Shkreli claims were verified via search-extracted
  verbatim snippets + corroboration, **not hands-on use** — which is exactly why the live trial
  recon is high-value. OpenBB/CCXT claims were verified against directly-fetched primary sources.
- **Vendor metrics:** "<100ms", "real-time", "direct from Nasdaq" are advertised specs; third-party
  "reviews" are largely affiliate/SEO sites repeating Gödel's figures. Not independently benchmarked.
- **Shkreli:** maximally conflicted (owner + affiliate code + fraud conviction).

**Refuted claims (killed 0-3):** (1) "Bloomberg banned *Gödel the product*"; (2) the
free/$80/$40 tier structure; (3) a Bloomberg "KYC barrier."

---

## 6. Open questions → answered by live recon

1. Gödel's **actual pricing tiers** and feature gating beyond the $996 headline.
2. The **full command/function list** (only a subset is documented publicly).
3. Real **data depth per module**, real-time vs delayed, and latency feel.
4. Whether any competitor already owns a **command-driven or crypto-native** niche.
5. Data-licensing economics confirming crypto (CCXT, no keys) is materially cheaper to launch
   than equities.

_See the live-terminal recon prompt used to gather this (Phases 1 & 8 are the priorities)._

---

### Key sources
- <https://godelterminal.com/> · <https://www.findmymoat.com/tools/godel-terminal>
- <https://github.com/OpenBB-finance/OpenBB> · <https://github.com/ccxt/ccxt> · <https://docs.ccxt.com/>
- <https://www.youtube.com/watch?v=YhOdp87zwmk> · <https://www.youtube.com/watch?v=kJ-uqLwThMg> · <https://x.com/wagieeacc/status/1767965349377360019>
