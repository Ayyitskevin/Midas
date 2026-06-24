# Gödel Terminal — Live Hands-On Recon

> Hands-on teardown on a 14-day trial at app.godelterminal.com (version **v4.5.2**),
> conducted read-only (no settings changed, no orders placed, no payment entered).
> This is the authoritative primary source for Gödel's product surface — it supersedes
> the snippet-based [competitive teardown](./godel-competitive-teardown.md) wherever they differ.
> Captured 2026-06-24, market at/after US close.

---

## Command model

- **Entry:** press **backtick (`` ` ``)** to focus the terminal, then type a bare command
  (e.g. `EQS`) or **`TICKER` → `FUNCTION`** (select instrument, then function). Functionally
  equivalent to Bloomberg's `AAPL US Equity DES`.
- **Autocomplete** is context-aware with three sections: **COMMANDS**, **INSTRUMENTS** (every
  venue listing with a live price — e.g. `AAPL US` composite, `AAPL UW` Nasdaq, `AAPL UP` NYSE
  Arca, `AAPL VF` IEX…), and **NEWS STORIES**.
- **Footgun:** the selected security persists as a sticky "chip" at the start of the bar and must
  be escaped/backspaced, or you get nonsense like `BDTZ6 AAPL DES`.
- HELP via `HELP`, top-bar link, or **F1**.

## Full command list (in-app palette + docs)

**Company & Security Analysis:** `DES` overview · `FA` financials · `ERN` earnings estimates ·
`EM` earnings matrix · `SI` short interest · `GR` ratio/relationship · `ANR` analyst ratings ·
`EVT` events (coming soon) · `DVD` dividends.

**Market Data & Surveillance:** `QM` quote monitor · `FOCUS` single-security quote · `TAS` time &
sales · `HCP` historical change % · `WEI` world equity indices · `WEIF` index futures · `GLCO`
global commodity futures · `FX` forex · `MOST` most active · `HDS` holders/13F · `N`/`CN`/`NH` news ·
`TOP` top news (Reuters) · `TREND` trending · `HALT` halts · `ALLQ` all venue quotes · `SECF`/`SEARCH`/`TK`
finder · `WJI` Wojak (chat sentiment) index · `IMAP` intraday index map · `HMAP` index heatmap · `NI` news search.

**Portfolio & Risk:** `EQS` equity screener (Beta) · `OMON`/`OPT` option chain · `OVME` Black-Scholes ·
`CALC` calculator · `BROK` brokerage connect · `AUM` brokerage AUM.

**Charting & Technicals:** `G` chart (TradingView) · `GIP` intraday chart · `HMS` multi-security
comparison · `HP` historical prices.

**Fundamentals & Filings:** `CF` SEC filings (EDGAR) · `IPO` IPOs · `TRAN` transcript hub.

**Utilities/Other:** `HELP` · `CHAT` community chat · `ACM` account · `PDF` settings · `AL` alerts ·
`NOTE` notes · `ENT` entitlements · `CHANGE` changelog · `CWP` company website · `PAT`/`PRT` pattern
search · `RES` research reports · `XPRT` expert narratives · `CITADEL` · `ERR` support.

**Roadmap (docs):** `PORT` portfolio analytics, `MEMB` index membership, EQS v2/v3, `GF`, `EQRV`,
ETFs/mutual funds, more private-company data. **API:** REST + WebSocket, enterprise-only, "coming soon."

## Per-function notes

- **DES** — dense single-screen overview: description, CEO, 1Y/intraday chart, market cap, EPS
  estimates, analyst ratings; snapshot panel with float, insiders/institutions %, P/S, P/B, EV/EBITDA,
  trailing/fwd P/E, beta, short interest & ratio. "The first command analysts type."
- **FA** — standardized IS/BS/CF, quarterly/yearly, 8 quarters visible, **Excel export**.
- **OMON/OPT** — realtime chain with full greeks (**Theta, Rho, Delta, Vega, Epsilon, Lambda**),
  per-strike IV & volume.
- **ALLQ** — decomposes a composite into named venues with realtime Last/Chg/Vol + **Level-1 bid/ask + sizes**.
- **G** — **literally TradingView** (logo visible); full indicator/drawing suite, multi-timeframe, log/%/auto scales.

## Asset coverage

Equities (full, multi-venue) · ETFs/indices (WEI/IMAP/HMAP) · **options with full greeks** · futures
(`ES1 CME` realtime + a delayed GODEL/CNBC feed; commodities via GLCO) · FX (`EURUSD FX1`) · **crypto**
("Global Crypto Composite" `BTCUSD GBL`; ALLQ → **Coinbase, Kraken, Bitstamp, Bitfinex**, **Level-1 only —
no L2 depth ladder**). **No fixed-income/rates** command (only a #bonds chat channel).

## Charting

TradingView engine — full studies catalog, drawing tools, multi-pane, comparison overlays (also `HMS`/`GR`).

## Screening (EQS, Beta)

Filters are **valuation/fundamentals only** — Currency, Venue, Country, Sector, Market Cap, P/E, P/S, P/B,
P/CF, EPS, Revenue. **No technical/volume/performance filters, no crypto screener.** Export to Excel.
Surfaces private/pre-IPO names (e.g. SpaceX/SPCX ~$2T).

## Workspace / UX

Grid-tiled panels, named workspace tabs (`+`), pop-out per panel (multi-monitor). Rich keyboard shortcuts
(Tab cycle, Shift+arrows move, Ctrl+Shift+arrows snap, Option+arrows resize, ⌘Z undo close).
**Panel linking = 7 colored "link groups"** — panels sharing a color sync their security. *Subtlety:* a
bare ticker in the command bar sets a global active security but does **not** push to linked panels;
linking syncs panels to each other. QM watchlists up to **400 tickers**, batch import.

## News & AI

- **News (N):** ticker-filtered, multi-wire (Reuters, AP, MT Newswires, Benzinga, Zacks, MarketBeat,
  MarketLine) + Form 4 inline + global breaking crawl; "ms" latency; deep history.
- **AI: none.** No copilot/assistant anywhere. `CHAT` is human community chat (Discord-style channels) with
  the satirical **Wojak Index (WJI)** sentiment gauge. `RES`/`XPRT` are reports, not generative AI.

## Pricing (confirmed)

| Tier | Price | Notes |
|---|---|---|
| Monthly | **$118/mo** | terminal + paid chat channels |
| Annual | **from $996/yr** (save 30%, ≈$83/mo) | single invoice |
| Team/Enterprise | **Talk to Sales** (2+ seats) | org billing, compliance/audit, account rep |

**FINRA-licensed (professional) users: +$30/mo** real-time Nasdaq surcharge ($148/mo or $996+$360/yr).
14-day free trial unlocks most features.

## Founder's critique — the takeaways for Midas

**Moat (3):** (1) backtick command bar with live multi-venue, news-blended autocomplete at $996; (2)
real-time options chains with full greeks bundled in; (3) embedded trader community/chat + WJI sentiment
(network-effect stickiness).

**Confirmed gaps a competitor can exploit:**
1. **No AI/copilot at all** — wide open.
2. **No fixed income/rates; no L2 crypto depth** (Level-1 only).
3. **Shallow Beta screener** (valuation only; no technicals/volume/performance; no crypto screener).
4. **No portfolio/risk analytics** (PORT roadmap).
5. UX bugs: sticky command "chip"; link-vs-command-bar confusion; several core panels still Beta.

**Surprises:** no AI in 2026; private/pre-IPO names quoted (SpaceX); embedded trader chat in a pro
terminal; charting is literally TradingView.

**Open questions:** trial vs paid real-time entitlements per asset class; history depth; whether any L2
depth exists; full bonds/rates story; RES/XPRT quality; API specifics.
