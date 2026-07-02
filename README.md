# MIDAS

**A self-hosted, Bloomberg-style terminal for crypto.** Type mnemonic commands
(`BTC/USDT GP`, `ETH/USDT BOOK`, `W`, `SCAN`) into a command line to spawn tiling
panels — charts, L2 order books, derivatives, ~115 indicator/analytics boards,
on-chain/DEX, alerts and portfolio — across a dense, dark workspace. Your
machine, your data, your keys. Inspired by [Gödel Terminal](https://godelterminal.com).

[![CI](https://github.com/ayyitskevin/midas/actions/workflows/ci.yml/badge.svg)](https://github.com/ayyitskevin/midas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

**Free to self-host, forever.** A hosted tier (**$20/month flat** — we run it,
you just log in) is coming: [join the waitlist](#hosted-midas--20month-flat).

<!-- The single biggest adoption win is a screenshot or GIF. Drop one in and
     uncomment:
<p align="center"><img src="docs/screenshot.png" alt="The Midas terminal" width="900"></p>
-->

> **Try it in 60 seconds — no API keys, fully offline:** `pnpm install && pnpm dev`.
> The default provider serves a deterministic *synthetic* market, so the whole
> terminal runs with zero config; point it at a live source when you're ready.

## Why Midas

- **Crypto-native.** Multi-exchange via [CCXT](https://github.com/ccxt/ccxt) —
  spot, perps, funding/OI, honest liquidations, on-chain/DEX. Symbols are
  `BASE/QUOTE` (e.g. `BTC/USDT`).
- **Honest about its data.** Every surface labels whether it's **live**,
  **synthetic**, or **unavailable** — Midas never passes mock or delayed data off
  as real. It's a first-class principle, not an afterthought.
- **Self-hosted & non-custodial.** Runs on your machine; it *reads* markets and
  never custodies funds or places orders.
- **Deep, fast, keyboard-first.** ~115 indicator/analytics boards, a ⌘K palette,
  tiling panels, saved scans and shareable deep-links — all driven from the
  command line.

---

## Highlights

- **Command-driven UI.** A Bloomberg-style command line (`SYMBOL FUNCTION`
  grammar) with history and fuzzy autocomplete, plus a **⌘K / Ctrl-K palette**
  that jumps to any command or symbol.
- **Tiling panel workspace.** Drag, resize and arrange panels on a 12-column
  grid; named workspaces and layout/watchlists persist locally and (optionally)
  sync per-user to the server. Any workspace exports to a file — or to a
  **share link** (⧉) that recreates it in someone else's Midas straight from
  the URL, nothing uploaded.
- **Charts & microstructure.** Candles with overlays (SMA/EMA/Bollinger/MACD/
  VWAP/Volume Profile) and drawings, L2 order book (`BOOK`), depth heatmap
  (`DEPTH`), time & sales, CVD.
- **Crypto derivatives.** Funding rates, open interest, basis/premium, honest
  liquidations with provenance, and cross-exchange aggregation.
- **~115 indicator & analytics boards.** Momentum, trend, volatility, volume,
  Ehlers cycles, plus a deep risk/performance suite (Sharpe, Sortino, Calmar,
  drawdown, VaR, Monte-Carlo, portfolio optimizers) — all in one searchable
  catalog (`BOARDS`).
- **Screening & alerts.** A signal `SCAN` with saveable criteria and scan-watch
  alerts; price/funding/%-change alerts that can open a panel when they fire.
- **On-chain / DEX.** DEX pools, CEX↔DEX basis and a swap price-impact estimate
  (`DEX`) — synthetic by default, live via Dexscreener when configured.
- **Portfolio.** Positions with live P&L, realized P&L, import/export.
- **Account & execution (non-custodial, opt-in).** Read-only keys light up your
  real balances (`BAL`), open orders (`ORD`), positions (`POSN`) and fills
  (`FILLS`), and a read-only account watcher turns every fill/cancel into a
  terminal toast + webhook push — even for orders placed outside Midas.
  Explicitly enable trading and the order ticket (`TICKET`) places — and `ORD`
  cancels — real orders behind two-step confirms, per-order **and** daily
  notional caps, idempotency, audit logs and webhook notifications, then tracks
  each placement live to filled/canceled. A red **LIVE TRADING** badge shows
  terminal-wide whenever it's on.
- **Pluggable data layer.** `mock` (deterministic, offline), `ccxt` (live
  multi-exchange crypto), `yahoo` (equities) — swap behind one interface.
- **Typed end-to-end** with a shared data contract package.

---

## Quickstart

### Option A — Docker (one command, recommended)

Self-host the whole stack with [Docker](https://docs.docker.com/get-docker/):

```bash
./scripts/deploy.sh      # bootstraps .env (random auth secret), builds, starts, health-checks
```

…or by hand, which is the same two steps:

```bash
cp .env.example .env     # optional — defaults run the offline mock feed
docker compose up -d     # build + run web + API
```

Open <http://localhost:8080> and start typing: `BTC/USDT`, then `BTC/USDT GP`,
then `BTC/USDT BOOK`.

The **web** container (nginx) serves the built UI and reverse-proxies `/api`
(REST **and** the `/api/stream` WebSocket) to the **server** container, so the
browser talks to a single origin. Edit `.env` to switch providers or add your
`ANTHROPIC_API_KEY`, then `docker compose up -d --build` to apply.

```bash
docker compose logs -f      # tail logs
docker compose down         # stop
MIDAS_DATA_PROVIDER=ccxt MIDAS_WEB_PORT=9000 docker compose up -d --build   # live crypto on :9000
```

### Option B — local dev

```bash
# 1. Install (Node 20+ and pnpm)
pnpm install

# 2. Run web + API together (mock data, no network needed)
pnpm dev
#   → web:  http://localhost:5173
#   → api:  http://localhost:4000
```

Open <http://localhost:5173> and start typing: `BTC/USDT`, then `BTC/USDT GP`, then `BTC/USDT BOOK`.

### Use live market data

The API defaults to the offline `mock` provider. To pull **live** quotes,
charts and news from Yahoo Finance (no key required, needs internet):

```bash
MIDAS_DATA_PROVIDER=yahoo pnpm dev
```

For **live crypto** (no API key needed) via any [CCXT](https://github.com/ccxt/ccxt)
exchange — the cornerstone of Midas's crypto-native direction (see the
[competitive teardown](./docs/research/godel-competitive-teardown.md)):

```bash
MIDAS_DATA_PROVIDER=ccxt MIDAS_CCXT_EXCHANGE=binance pnpm dev
# symbols use BASE/QUOTE, e.g. BTC/USDT, ETH/USDT
```

With the `ccxt` provider, the live order book, trades tape and ticker also stream
over **CCXT Pro** websockets (no API key needed for public market data).

> Running on Claude Code on the web? The sandbox network policy may block
> external finance hosts. Either run locally, or allowlist
> `query1.finance.yahoo.com` / `query2.finance.yahoo.com` in your
> [environment's network policy](https://code.claude.com/docs/en/claude-code-on-the-web).

---

## Command reference

| Command | Aliases        | Needs symbol | Description                                   |
| ------- | -------------- | ------------ | --------------------------------------------- |
| `DES`   | `DESC`, `DS`   | yes          | Snapshot quote + key stats for a security.    |
| `GP`    | `CHART`, `G`   | yes          | Historical chart + studies (MA/BB/VWAP/RSI/MACD/vol-profile). |
| `GIP`   | `INTRADAY`     | yes          | Intraday price chart (5-minute candles).       |
| `HP`    | `HISTORY`, `HISTPX`, `OHLC` | yes | Historical prices — a tabular OHLCV history per bar (O/H/L/C, change% vs the prior close, volume) with 5D/1M/3M/1Y/5Y lookbacks, a period summary (high/low, total change, avg volume, up/down days) and sortable date / change% / volume columns. The data-table complement to the chart (`G`/`GIP`). |
| `COMP`  | `COMPARE`, `CMP` | no         | Overlay several symbols rebased to % to compare performance.|
| `RATIO` | `SPREAD`       | no           | Chart the ratio (A/B) or spread (A−B) of two symbols.|
| `PAIR`  | `PAIRS`, `ZSCORE`, `STATARB` | no | Pairs / stat-arb monitor — ratio with rolling mean ±σ bands, a z-score oscillator and mean-reversion half-life. |
| `BOOK`  | `DOM`, `OB`    | yes          | Live Level-2 order book / depth of market.     |
| `DEPTH` | `DHEAT`, `OBHEAT` | yes       | Order-book depth heatmap — resting liquidity over time as a price × time grid, with the mid track. |
| `DEX`   | `ONCHAIN`, `POOLS` | yes      | On-chain / DEX liquidity pools for an asset — price, TVL, 24h volume, fee tier & an estimated swap price-impact per pool, plus the CEX↔DEX basis (premium/discount), with a live/synthetic data-honesty badge (synthetic until an on-chain source is configured). |
| `TAS`   | `PRINTS`, `TS` | yes          | Live streaming trade prints (time & sales).    |
| `CVD`   | `FLOW`, `OFD`  | yes          | Order-flow / cumulative volume delta — buy vs sell pressure over time + per-window delta bars. |
| `IMB`   | `IMBALANCE`, `OBI` | yes      | Order-book imbalance — top-N bid vs ask depth pressure over time with a live gauge. |
| `LQA`   | `LIQUIDITY`, `SPREADS` | no   | Liquidity board — watchlist ranked by bid/ask spread (bps) and top-of-book depth. |
| `ALLQ`  | `XQ`, `VENUES` | yes          | Compare a pair across exchanges (best bid/ask).|
| `DXV`   | `FUNDV`, `VFUND`, `VENUEDERIVS` | yes | Cross-exchange derivatives — a perp's funding rate and open interest across every venue side-by-side, with the cross-venue funding spread (Δfund) as a funding-arb signal (long the cheapest, short the dearest) and aggregate OI. Complements `ALLQ` (spot) and `FUND` (single-venue). |
| `FUND`  | `OI`, `LIQ`    | yes          | Funding rate, open interest, liquidations.     |
| `FUNDR` | `RATES`, `CARRY` | no         | Funding + open interest across the top perps, sortable.|
| `LIQS`  | `LIQUIDATIONS`, `REKT` | no   | Market-wide liquidations feed across the top perps — **honestly labeled**: shows the data source, whether the exchange actually publishes a public liquidation feed (many don't — Binance removed its in 2021), the freshness, and a throttling/under-reporting caveat instead of a silent empty "live" feed.|
| `SCR`   | `EQS`, `MOVERS`| no           | Screen crypto by volume / 24h change / price.  |
| `HEAT`  | `MAP`, `HM`    | no           | Market heatmap — treemap sized by volume, colored by 24h %. |
| `MOV`   | `OVERVIEW` | no    | Market overview — top gainers, losers, most active + breadth.|
| `CORR`  | `COR`, `CORREL`| no           | Return-correlation matrix across your watchlist.|
| `AVGCORR` | `AVGCOR`, `CORRREGIME`, `MEANCORR` | no | Average-correlation regime — mean pairwise correlation across your watchlist over time; high = risk-off, low = dispersion. |
| `BREADTH` | `ADLINE`, `PARTICIPATION`, `ABOVEMA` | no | Market-breadth oscillator — the % of your watchlist above its N-day moving average over time; high = broad strength, low = weakness. |
| `BETA`  | `BTCBETA`, `BETAS` | no       | Beta board — each watchlist symbol’s beta, correlation & R² vs BTC from daily returns. |
| `CAPTURE` | `UPDOWN`, `CAPRATIO`, `UPCAPTURE` | no | Up/down capture vs BTC — how much of BTC’s up vs down moves each watchlist symbol catches, with the capture ratio. |
| `RBETA` | `ROLLBETA`, `RCORR` | yes     | Rolling beta & correlation vs BTC — how a symbol’s sensitivity to Bitcoin drifts over a trailing window. |
| `SCAT`  | `SCATTER`, `REGRESS` | yes    | Returns scatter vs BTC — daily returns with the fitted regression line (beta, alpha, R²). |
| `VPVR`  | `VP`, `VOLPROFILE`, `VBP` | yes | Volume profile — traded volume binned by price with the Point of Control & 70% value area (VAH/VAL). |
| `SHARPE`| `SORTINO`, `RISKADJ` | no    | Risk-adjusted return board — Sharpe & Sortino (annualized) with annualized return & vol across your watchlist. |
| `RSHARPE` | `ROLLSHARPE`, `RSHARP` | yes | Rolling Sharpe — the trailing annualized risk-adjusted return over a moving window, showing when an edge strengthened or decayed. |
| `DD`    | `DRAWDOWN`, `UNDERWATER`, `MDD` | no | Drawdown monitor — max & current drawdown, time underwater and an underwater curve across your watchlist. |
| `CALMAR`| `MARRATIO`, `RETDD` | no | Calmar-ratio board — annualized return ÷ max drawdown across your watchlist, ranking return per unit of worst drawdown. |
| `CAL`   | `CALENDAR`, `EVENTS`, `ECON` | no | Market calendar — funding settlements, options/futures expiries and candle closes, with countdowns. |
| `VOL`   | `VOLATILITY`, `ATR`, `RV` | no | Volatility dashboard — realized vol, ATR% and high-low range ranked across your watchlist. |
| `VAR`   | `DIST`, `HIST`, `CVAR` | yes  | Return distribution & risk — histogram with vol, skew, kurtosis and historical VaR / expected shortfall. |
| `SKEW`  | `SHAPE`, `KURTOSIS`, `TAILS` | no | Return-shape board — skewness & excess kurtosis of each watchlist symbol’s daily returns, flagging fat-tailed & asymmetric names. |
| `VTS`   | `VOLTERM`, `TERM` | yes       | Volatility term structure — realized vol across 7d…180d lookbacks, flagging rich/cheap near-term vol. |
| `VCONE` | `VOLCONE`, `VCONES`, `RVCONE` | yes | Volatility cones — realized-vol percentiles across 10…120d horizons with the current vol overlaid, flagging rich/cheap. |
| `MC`    | `MONTECARLO`, `CONE` | yes    | Monte Carlo projection cone — GBM price forecast fan (5–95 percentiles) from historical drift & vol. |
| `BACKTEST` | `BT`, `STRATEGY`, `SMACROSS`, `RSIBT`, `BOLLBT`, `MACDBT` | yes | Strategy backtest — SMA-crossover, RSI mean-reversion, Bollinger-band reversion or MACD crossover: strategy equity vs buy & hold with total return, max drawdown, win rate & trade count. |
| `MOM`   | `MOMENTUM`, `RS`, `STRENGTH` | no | Momentum / relative-strength board — 24h/7d/30d returns ranked across your watchlist. |
| `STRETCH` | `OVERSOLD`, `BBANDS`, `MEANREV` | no | Mean-reversion screener — watchlist ranked by z-score & Bollinger %B vs its moving average, flagging overbought/oversold. |
| `HURST` | `REGIME`, `TRENDREV`, `FRACTAL` | no | Trend vs mean-reversion board — each symbol’s Hurst exponent (R/S) classifying trending, mean-reverting or random-walk. |
| `EFFICIENCY` | `EFFRATIO`, `KER` | no | Trend-efficiency board — Kaufman’s Efficiency Ratio (net move ÷ path) ranks how clean vs choppy each symbol’s trend is. |
| `SCAN`  | `SCANNER`, `SIGNALS`, `SETUP` | no | Signal scanner — watchlist SMA20/50 trend, RSI(14) overbought/oversold & 52-week range position, ranked by a bull/bear score; filter by criteria, save named scans, and watch a scan to be notified when new symbols match. |
| `MTF`   | `MULTITF`, `TIMEFRAMES`, `MTREND` | yes | Multi-timeframe trend — SMA trend & RSI across 1H/1D/1W/1M with a consensus read of whether the frames are in gear. |
| `RRG`   | `ROTATION`, `ROT` | no       | Relative rotation graph — watchlist symbols by RS-Ratio × RS-Momentum vs BTC, with rotation tails. |
| `SEAS`  | `SEASON`, `SEASONALITY`, `TOD` | yes | Returns seasonality — average return by UTC hour-of-day and day-of-week as a heat grid. |
| `MRET`  | `MONTHLY`, `CALRET` | yes     | Monthly returns heatmap — month-over-month % as a year × month grid with compounded year totals. |
| `RCAL`  | `RETCAL`, `DRET`, `DAILYRET` | yes | Daily returns calendar — contribution-style heatmap of daily % returns with best/worst day, positive-day rate & current streak. |
| `PREM`  | `PREMIUM`, `SPREAD` | yes    | Perp basis monitor — premium vs spot, funding rate & APR, with a live premium history. |
| `CARRY` | `CASHCARRY`, `CARRYTRADE` | no | Funding-carry board — perps ranked by funding APR with spot-vs-perp basis and the carry leg. |
| `FPL`   | `FUNDPNL`, `CARRYPNL` | yes  | Funding P&L forecaster — project a perp position’s carry over a horizon at the current funding rate. |
| `FRH`   | `FUNDHIST`, `FRATE` | yes     | Funding-rate history — a perp’s funding settlements over time with the average and current APR. |
| `ARB`   | `ARBITRAGE`, `XSPREAD` | yes  | Cross-exchange arb scanner — best bid/ask across venues, spread % and crossed-book flag. |
| `SLIP`  | `SLIPPAGE`, `IMPACT` | yes    | Slippage estimator — average fill & market impact for an order size, walking the live book. |
| `TWAP`  | `EXEC`, `ALGO`, `SLICE` | yes | TWAP execution planner — slice a large order over time and compare impact vs an aggressive block. |
| `AI`    | `ASK`          | no           | Claude copilot grounded in your live data.     |
| `W`     | `WATCH`, `WL`  | no           | Your personal watchlist — last, % change with heat, and a 24h sparkline per symbol. |
| `Q`     | `QM`, `QUOTE`  | no           | Dense live quote grid for watchlist symbols.  |
| `PORT`  | `POS`          | no           | Paper portfolio — positions, realized & live P&L, trade history. |
| `BAL`   | `BALANCE`, `BALANCES`, `ACCTBAL` | no | Read-only exchange account balances — per-asset free/used/total, USD value & allocation %, with a live/demo data-honesty badge. Non-custodial: read with read-only API keys from the server env (`ccxt` provider); Midas never places orders or holds funds. Synthetic demo book until keys are set. |
| `ORD`   | `ORDERS`, `OPENORDERS`, `OO` | no | Read-only open (resting) orders — symbol, side, type, price, amount, filled % & quote value, with a live/demo badge. Non-custodial: reads only (`fetchOpenOrders`) — never places or cancels orders. Synthetic demo set until read-only keys are set. |
| `POSN`  | `POSITIONS`, `LIVEPOS`, `XPOS` | no | Read-only open derivatives positions — side, size, entry, mark, unrealized P&L (& %), liquidation price & leverage, with a total uPnL and a live/demo badge. Non-custodial: reads only (`fetchPositions`) — never opens or closes positions. Synthetic demo set until read-only keys are set. |
| `FILLS` | `MYTRADES`, `FILLHIST`, `EXECUTIONS` | no | Your own executions (my-trades) — time, side, price, amount, cost, fee & maker/taker, with a live/demo badge. Symbol-aware (some venues only serve fills per symbol: `BTC/USDT FILLS`). Read-only; synthetic demo fills until keys are set. |
| `TICKET`| `ORDER`, `OE`, `PREVIEW` | yes | Order ticket — build & validate a market/limit order and preview the fill against the live book: average fill, fee, slippage, takes-now vs rests, total cost / net proceeds, book-exhausted warning. **Previews by default; placement is OFF** unless you explicitly enable live trading (see below) — then a red LIVE banner + two-step confirm, with a server-side notional cap. After placement the ticket **tracks the order live** (open → partially filled → filled/canceled, with a fill progress bar). When trading is live, `ORD` also gains a two-step per-order **cancel**. |
| `START` | `TOUR`, `GETSTART`, `INTRO` | no | First-run tour — six one-click rows that each **run** a real command, teaching the grammar by doing. Opens automatically on the very first visit. |
| `SYS`   | `STATUS`, `SYSTEM` | no | System status — provider, version, uptime, and which background loops are actually running (watcher, stream nudge, digest, equity snapshots, trading gate). |
| `WN`    | `WHATSNEW`, `CHANGELOG`, `RELEASES` | no | What's New — release highlights in-terminal, newest first. Pairs with a one-time "Midas updated to vX" toast when your server moves to a new version. |
| `AEQ`   | `ACCTEQ`, `ACCTCURVE` | no | Your real account's **equity curve** — periodic server-side snapshots of total value + unrealized P&L (read-only), persisted across restarts and accruing with no browser open (`MIDAS_EQUITY_SNAP_MS`, default hourly). Outages render as honest gaps, never interpolated points. |
| `XQL`   | `EXECQ`, `TCA` | no | **Execution quality** from your own fills — maker/taker mix, fee totals by currency, notional, and realized slippage vs the estimates `TICKET` recorded at placement (notional-weighted, with an honest coverage %). Per-symbol breakdown; symbol-aware like `FILLS`. |
| `RHEAT` | `EXPOSURE`, `PRISK` | no      | Portfolio risk heat — per-position P&L, exposure and liquidation distance across your book. |
| `EXP`   | `EXPO`, `WEIGHTS`, `GROSS` | no | Portfolio exposure breakdown — net/gross, long vs short, per-asset weights, leverage & concentration. |
| `PBETA` | `PORTBETA`, `BWEIGHT`, `NETBETA` | no | Beta-weighted portfolio exposure to BTC — collapse the book into one BTC-equivalent delta with per-position contributions. |
| `REBAL` | `REBALANCE`, `RETARGET`, `ALLOCATE` | no | Rebalance calculator — set target weights for your holdings and get the buy/sell trades, per-position drift & turnover. |
| `RPARITY` | `RISKPARITY`, `PARITY`, `INVVOL` | no | Risk-parity weights — inverse-volatility target weights for your watchlist so every name contributes equal risk. |
| `OPT` | `MINVAR`, `GMV`, `OPTIMIZE` | no | Minimum-variance optimizer — covariance-aware target weights (w = Σ⁻¹·1 / 1ᵀΣ⁻¹·1) for the lowest-variance fully-invested watchlist book. |
| `MSR` | `TANGENCY`, `MAXSHARPE`, `SHARPEOPT` | no | Max-Sharpe (tangency) optimizer — covariance-aware target weights (w ∝ Σ⁻¹·(μ−rf)) for the highest risk-adjusted-return fully-invested watchlist book. |
| `FRONTIER` | `EF`, `EFFRONTIER`, `CML` | no | Markowitz efficient frontier — plots the risk/return frontier for your watchlist with the GMV (min-variance) and tangency (max-Sharpe) portfolios, the equal-weight book and each asset. |
| `RISKB` | `RISKBUDGET`, `MCTR`, `RBUDGET` | no | Risk-budget board — decomposes your portfolio variance into each holding's marginal and percent contribution to risk (MCTR), so you see which names drive the swings vs their weight. |
| `ULCER` | `UI`, `MARTIN`, `ULCERINDEX` | no | Ulcer Index board — ranks watchlist drawdown pain (depth × duration, RMS of drawdowns) with the Martin ratio (annualized return ÷ Ulcer). |
| `GPR` | `GAINPAIN`, `GAINTOPAIN`, `G2P` | no | Gain-to-Pain board — ranks watchlist return quality by Σ returns ÷ Σ losses (Schwager GPR): how much net return per unit of downside endured. |
| `OMEGA` | `OMG`, `OMEGARATIO` | no | Omega ratio board — ranks watchlist names by Σ gains above a threshold ÷ Σ shortfalls below it; a full-distribution alternative to Sharpe with an adjustable τ. |
| `DIVR` | `DIVERSIFICATION`, `DIVRATIO` | no | Diversification ratio — weighted-avg asset vol ÷ portfolio vol for the equal-weight watchlist book, with the effective number of independent bets (DR²). |
| `TAIL` | `TAILRATIO`, `TAILS` | no | Tail-ratio board — \|95th pct\| ÷ \|5th pct\| of returns per watchlist name: whether the extreme moves favor the upside (>1) or the downside (<1). |
| `PAIN` | `PAININDEX`, `PAINRATIO` | no | Pain Index board — ranks watchlist average drawdown depth (mean underwater) with the Pain ratio (annualized return ÷ Pain Index). |
| `KRATIO` | `KRAT`, `KESTNER` | no | K-ratio board — Kestner trend-consistency: the log-price trend slope ÷ its standard error (a t-stat), ranking watchlist names by how steady their climb is. |
| `VREG` | `VOLREGIME`, `VOLREG` | no | Vol-regime board — short-window ÷ long-window realized volatility per watchlist name (expanding >1 / contracting <1), with the percentile of today's vol in its own history. |
| `ACF` | `AUTOCORR`, `AUTOCORRELATION` | no | Autocorrelation board — lag-1/2/3 return autocorrelation per watchlist name: positive = momentum (returns persist), negative = mean-reverting (returns reverse). |
| `STERLING` | `STERLINGRATIO`, `STERL` | no | Sterling ratio board — annualized return ÷ (average drawdown + 10%): a drawdown risk-adjusted return that averages drawdown episodes (vs Calmar's single worst). |
| `INFO` | `INFORATIO`, `IR` | no | Information-ratio board — each watchlist name's active return over BTC ÷ its tracking error: how much excess return per unit of benchmark-relative risk. |
| `BURKE` | `BURKERATIO` | no | Burke ratio board — annualized return ÷ √(Σ drawdown²): the root-sum-square of drawdown-episode depths penalizes deep and frequent drawdowns more than Sterling's average or Calmar's single worst. |
| `TREYNOR` | `TREYNORRATIO` | no | Treynor ratio board — annualized return ÷ beta-to-BTC: return per unit of systematic (market) risk. Completes the Sharpe / Information / Treynor trio. |
| `ALPHA` | `JENSEN`, `JALPHA` | no | Jensen's alpha board — annualized return minus the CAPM-predicted return (beta·BTC-return): the excess a name delivers beyond what its BTC exposure alone explains. Positive = genuine outperformance. |
| `APPRAISAL` | `APPR`, `APRATIO` | no | Appraisal ratio board — Jensen's alpha ÷ idiosyncratic (residual) volatility: stock-specific outperformance per unit of the diversifiable risk taken to get it (Treynor–Black). |
| `M2` | `MODIGLIANI`, `MSQUARED` | no | M² (Modigliani) board — each name's return rescaled to BTC's volatility (Sharpe × σ_BTC): what it would have returned at the market's risk level, in directly comparable return units. |
| `CSR` | `COMMONSENSE`, `CSRATIO` | no | Common-sense ratio board — tail ratio × gain-to-pain: rewards a name only when it has both a fat right tail and an efficient win/loss balance. ≥1 is the green light. |
| `RSTAB` | `SHARPESTAB`, `STAB` | no | Rolling-Sharpe stability board — mean ÷ stdev of each name's rolling-Sharpe series: ranks who delivers a consistent risk-adjusted edge vs whose edge flickers. High and steady beats high and erratic. |
| `ASR` | `ADJSHARPE`, `ADJUSTEDSHARPE` | no | Adjusted Sharpe ratio board (Pezier-White) — the Sharpe penalized for negative skew and excess kurtosis: docks names whose smooth Sharpe hides a fat left tail, rewards genuinely well-shaped returns. |
| `BETAETH` | `EBETA`, `BETAVS` | no | Dual-beta board — each name's beta to ETH and to BTC over the same window, plus their divergence (βETH − βBTC): surfaces ETH-leaning vs BTC-leaning names across the watchlist. |
| `MARTIN` | `UPI`, `MARTINRATIO` | no | Martin ratio (Ulcer Performance Index) term structure — annualized return ÷ Ulcer Index across 1M/3M/6M/1Y trailing windows: return per unit of drawdown pain, read as a curve over horizon. |
| `LEADLAG` | `LEAD`, `XCORR` | no | Lead-lag board — the lag of peak cross-correlation between each name and BTC: negative = the name leads BTC (moves first), positive = it lags. Finds early-warning tells and followers. |
| `DDREC` | `RECOVERY`, `TTR` | no | Drawdown recovery board — days underwater per name: current unresolved drawdown, longest underwater stretch, and average time to recover past drawdowns. Ranks how long pain lasts, not just how deep. |
| `VOV` | `VOLOFVOL`, `VOVOL` | no | Vol-of-vol board — the coefficient of variation of each name's rolling volatility (stdev ÷ mean of the rolling vol): ranks whose risk level itself is stable vs whose whipsaws between calm and chaos. |
| `STREAK` | `STREAKS`, `RUNS` | no | Up/down streak board — current signed run (+up / −down days), longest up and down runs, and the share of up days per name: momentum-persistence and capitulation tells from the raw return signs. |
| `RANGE` | `NR7`, `EXPANSION`, `RNG` | no | Range-expansion / NR7 board — each name's latest true range vs its trailing average: EXP ratio (>1 expanding, <1 coiling), today's range as a % of price, and its rank among the last 7 days (NR7 = narrowest, a coiled-spring breakout setup). |
| `UVOL` | `RVOL`, `SURGE`, `VOLSURGE` | no | Unusual-volume board — each name's latest volume vs its trailing average: RVOL (relative volume, today ÷ avg), a z-score vs that window, and the day's direction so a spike reads as accumulation (▲ up-day) or distribution (▼ down-day). |
| `GAP` | `GAPS`, `GAPFILL` | no | Gap board — each name's open-vs-prior-close jump at the daily roll: today's signed gap, the typical (average absolute) gap size, the same-day fill rate (how often price retraces to the prior close), and the net up − down gap bias. |
| `HILO` | `PROXIMITY`, `NEARHIGH` | no | High/low proximity board — where each name's close sits in its N-day range (POS 0 = low → 100 = high), how far it is below the period high and above the period low, and a new-high / new-low flag. Spot names pressing a breakout vs basing near support. |
| `OBV` | `ACCUM`, `ACCUMULATION` | no | On-balance-volume board — cumulative signed volume per name with its net up − down volume flow and the OBV trend (regression slope ÷ avg volume): ranks who is being accumulated (volume confirming up moves) vs distributed. |
| `CHOP` | `CHOPPINESS`, `CHOPPY` | no | Choppiness Index board — Dreiss’ 0–100 gauge of trending vs ranging per name (Σ true range ÷ net span, log-normalized): below ~38 is a clean trend, above ~62 is sideways chop. A regime filter that pairs with RANGE / NR7. |
| `BB` | `BOLL`, `PCTB`, `SQUEEZE` | no | Bollinger %B board — each name's position within its Bollinger bands (%B: 0 = lower, 0.5 = middle, 1 = upper), the band width relative to price, and a squeeze flag when bandwidth sits in the bottom quintile of its recent range (compression before expansion). |
| `RSI` | `RSI14`, `WILDER` | no | RSI screener — Wilder's 14-period RSI for every watchlist name with overbought (≥70) / oversold (≤30) flags: a momentum-oscillator scan across the whole list (the chart's RSI sub-pane is per-symbol). |
| `MACD` | `MACDX`, `SIGNAL` | no | MACD signal board — 12/26/9 MACD line, price-normalized histogram, and bull/bear state with a fresh-cross marker for every watchlist name: a trend-momentum scan across the list (the chart's MACD is per-symbol). |
| `ADX` | `DMI`, `DIRECTIONAL` | no | ADX / DMI board — Wilder's trend-strength gauge per name: ADX (≥25 strong trend, <20 rangebound) with +DI / −DI directional indicators and which one leads. Answers “is there a trend, how strong, and which way”. |
| `MFI` | `MONEYFLOW`, `MF` | no | Money Flow Index board — the volume-weighted RSI (typical price × volume, 14-period) per name with overbought (≥80) / oversold (≤20) flags: combines price and volume into one oscillator, distinct from RSI (price only) and OBV (cumulative). |
| `SUPER` | `SUPERTREND`, `ST` | no | Supertrend board — the ATR trend-follow regime per name: up / down direction, the ATR trailing-stop level, how far price sits from that stop, and a fresh-flip marker. A popular crypto trend signal across the whole watchlist. |
| `TREND` | `PERSIST`, `MATREND` | no | MA trend-persistence board — how durably each name holds one side of its SMA: the current consecutive run of closes above (+) / below (−) the average, how far price sits from it, and the share of days spent above. Moving-average-relative trend, distinct from STREAK. |
| `AROON` | `AROONOSC`, `TRENDAGE` | no | Aroon board — trend by time-since-extreme per name: Aroon-Up / Aroon-Down (how recently the N-bar high vs low printed, 0–100) and the oscillator (up − down). Measures the age of the extreme, not price distance (distinct from HILO). |
| `CCI` | `CCI20`, `COMMODITY` | no | Commodity Channel Index board — each name's typical price vs its average ÷ mean deviation, with overbought (≥+100) / oversold (≤−100) flags: a mean-deviation oscillator distinct from RSI (gains/losses) and MFI (volume-weighted). |
| `KELT` | `KELTNER`, `KC` | no | Keltner channel board — an EMA midline wrapped by ATR-scaled bands per name: where the close sits in the channel (0 lower · 50 mid · 100 upper), the band width relative to price, and an up/down breakout flag when price closes outside. The ATR-based volatility-band complement to Bollinger (BB). |
| `STOCH` | `STOCHASTIC`, `STOCH14`, `KD` | no | Stochastic oscillator board — Lane's %K (the close's position in its N-bar high-low range) and %D signal line per name, with overbought (≥80) / oversold (≤20) zones and a fresh %K-vs-%D crossover flag. A range-position oscillator, distinct from RSI (gains/losses), MFI (volume-weighted) and CCI (mean deviation). |
| `DON` | `DONCHIAN`, `TURTLE`, `DC` | no | Donchian breakout board (the Turtle channel) — the prior N-bar highest-high / lowest-low channel per name: where the close sits in it (0 lower · 100 upper, exceeding on breakouts), the channel width relative to price, and an up/down flag on a new N-bar high / low. The pure price-extreme complement to the ATR (KELT) and stdev (BB) volatility bands. |
| `VTX` | `VORTEX`, `VI` | no | Vortex indicator board — +VI / −VI trend-direction lines (up vs down vortex movement ÷ true range over N bars) per name, their signed difference, which line leads, and a fresh +VI/−VI crossover flag. A trend-direction board, distinct from ADX (strength only), Aroon (time-since-extreme) and Supertrend (ATR stop). |
| `TTM` | `TTMSQUEEZE`, `SQZ` | no | TTM squeeze board (Carter) — flags when each name's Bollinger bands sit inside its Keltner channel (volatility compression → coiling), with a squeeze on/off state, a fired flag when it releases, and Carter's de-trended momentum (value, direction & rising/falling). A genuine BB-meets-KELT setup scanner. |
| `ICHI` | `ICHIMOKU`, `CLOUD`, `KUMO` | no | Ichimoku cloud board — the five-line system per name reduced to the latest signals: price vs the kumo (above = bull / below = bear / inside = neutral), the cloud colour (Senkou A vs B), a fresh Tenkan×Kijun cross, and the signed distance of the close from the cloud. The current cloud is read at the displaced supplier bar (displacement = Kijun). |
| `PSAR` | `SAR`, `PARABOLIC` | no | Parabolic SAR board (Wilder stop-and-reverse) — the trailing-stop trend per name: long (stop below price) / short (stop above), the signed distance of the close from the stop, the acceleration factor (trend maturity), and a fresh-flip flag when the stop reverses. An iterative trailing-stop system, distinct from the ATR-band Supertrend (SUPER). |
| `WILLR` | `WILLIAMS`, `WPR` | no | Williams %R board — where each name's close sits in its N-bar high-low range on a 0 to −100 scale (0 = top, −100 = bottom), with overbought (≥−20) / oversold (≤−80) flags. A momentum oscillator close to Stochastic's %K but inverted and unsmoothed. |
| `UO` | `ULTIMATE`, `ULTOSC` | no | Ultimate Oscillator board (Larry Williams) — buying pressure ÷ true range blended over three timeframes (7/14/28) weighted 4:2:1 into a 0–100 reading per name, with overbought (≥70) / oversold (≤30) flags. Blends short/medium/long momentum to cut the false divergences single-period oscillators give. |
| `TRIX` | `TRIPLE`, `TRIXOSC` | no | TRIX board — the 1-period % rate-of-change of a triple-smoothed EMA of price per name, with its signal line (EMA of TRIX), the histogram (TRIX − signal), the zero-line side (up/down) and a fresh TRIX×signal cross. Triple smoothing filters the noise a single EMA leaves: a zero-line momentum oscillator, distinct from MACD (dual EMA). |
| `CMO` | `CHANDE`, `CMO14` | no | Chande Momentum Oscillator board — (Σ up-moves − Σ down-moves) ÷ their total × 100 over N bars per name, on a ±100 scale with overbought (≥+50) / oversold (≤−50) flags. Uses raw sums (not smoothed averages like RSI), so it swings harder: a distinct momentum gauge from the RSI / Stochastic / CCI family. |
| `ELDER` | `ELDERRAY`, `ERAY` | no | Elder-Ray board (Alexander Elder) — bull power (high − EMA) and bear power (low − EMA) per name as a % of the trend EMA, with the EMA slope as the up/down trend filter. Shows whether buyers or sellers control price relative to the trend: a buyer/seller-pressure board distinct from the oscillator family. |
| `FISHER` | `FISH`, `EHLERS` | no | Fisher Transform board (Ehlers) — normalizes each name's median price into its N-bar range and applies the Fisher transform to sharpen turning points, with the trigger line (prior Fisher) and a fresh Fisher×trigger cross. A reversal-oriented oscillator with crisper turns than the smooth momentum family. |
| `DPO` | `DETREND`, `DETRENDED` | no | Detrended Price Oscillator board — each name's close from floor(N/2)+1 bars ago minus its N-bar SMA (as a % of the SMA), with an above/below cycle-mean flag. Strips the trend to expose the price cycle around the average; reaches back (never forward) so the screener has no look-ahead. A cycle-oriented oscillator, distinct from the trend/momentum family. |
| `COPP` | `COPPOCK`, `COP` | no | Coppock Curve board — a 10-period weighted MA of each name's summed 14- and 11-bar rate-of-change, with its zero-line side and a fresh trough (up) / peak (down) turn. A trough turn near/below zero is Coppock's classic long-term buy signal: a slow, bottom-spotting momentum gauge distinct from the fast oscillator family. |
| `BOP` | `BALOP`, `BPOW` | no | Balance of Power board — (close − open) ÷ (high − low) per bar, smoothed over N bars on a −1..+1 scale, per name, with a buyers/sellers side and the latest candle's raw reading. Measures who won each candle (close vs open within the range): a simple buyer/seller-pressure gauge distinct from Elder-Ray. |
| `ADL` | `ACCDIST`, `CHAIKINAD` | no | Accumulation/Distribution line board (Chaikin) — the cumulative money-flow-volume line (close position in range × volume) per name, reported as its normalized slope over N bars (net flow ÷ volume), its trend, and a fresh N-bar A/D high (accumulation breakout) / low (distribution breakdown). A cumulative volume-flow gauge distinct from OBV. |
| `CMF` | `CHAIKINMF`, `CMFLOW` | no | Chaikin Money Flow board — Σ(money-flow volume) ÷ Σ(volume) over N bars per name, bounded −1..+1, with a buyers/sellers side and a strong-flow flag (\|CMF\| ≥ 0.25). The bounded oscillator sibling of the A/D line: positive is accumulation, negative distribution. |
| `FORCE` | `FORCEINDEX`, `EFI` | no | Force Index board (Elder) — (close − priorClose) × volume, EMA-smoothed over N bars per name, normalized as FI ÷ (price × avg volume) so it's comparable across names, with a bulls/bears side and a rising/falling flag. Ties the size of each move to the volume behind it: a zero-line volume oscillator. |
| `EOM` | `EMV`, `EASE` | no | Ease of Movement board (Arms) — midpoint move × range ÷ volume, SMA-smoothed over N bars per name and normalized to a dimensionless index, with an up/down ease side. Measures how readily price moves relative to the volume required: positive = rose easily (big move on light volume), negative = fell easily. A volume/price-efficiency oscillator. |
| `PVT` | `PRICEVOL`, `PVTREND` | no | Price Volume Trend board — the cumulative ((close − priorClose)/priorClose) × volume line per name, reported as its normalized slope over N bars (volume-weighted % return), its trend, and a fresh N-bar PVT high / low. Like OBV but scaled by the size of each move: a volume-confirmed trend line distinct from OBV and the A/D line. |
| `MASS` | `MASSINDEX`, `MASSIDX` | no | Mass Index board (Dorsey) — Σ over 25 bars of EMA9(range) ÷ EMA9(EMA9(range)) per name, with the reversal-bulge state: bulge (≥ 27), setup (bulged then awaiting the drop), fired (just fell below 26.5 — the reversal warning) or normal. Watches the high-low range expand then contract to anticipate turns; a volatility-of-range signal distinct from the directional oscillators. |
| `QSTICK` | `QSTK`, `QS` | no | Qstick board (Chande) — the average candle body (close − open) over N bars per name, as a % of price, with an up/down body-bias side. Above zero means up-closes dominated the window (buying bias), below zero down-closes (selling bias): a simple candle-body sentiment gauge. |
| `NVI` | `PVI`, `VOLINDEX` | no | Volume Index board — the Negative & Positive Volume Index per name (cumulative lines that compound the daily return only on down-volume days, NVI = "smart money", or up-volume days, PVI), each vs its own EMA signal. Reports NVI's distance from its EMA and the bull/bear regime of both — NVI above its EMA is the strongest bull-market tell. |
| `CFO` | `FORECAST`, `CHANDEFO` | no | Chande Forecast Oscillator board — 100 × (close − the least-squares regression-line fit over N bars) ÷ close, per name, on a zero line with an above/below-fit side. Measures how far price sits from its own regression trend: above zero means it's running ahead of the fit, below means it lags. A regression-based oscillator distinct from the moving-average family. |
| `RWI` | `RANDOMWALK`, `RWALK` | no | Random Walk Index board — per name, the max over look-backs k=2..N of price displacement ÷ (ATR(k)·√k), split into RWIhigh (up-trend strength) and RWIlow (down-trend strength). A reading ≥ 1 means price out-ran a same-volatility random walk — a genuine trend; below 1 reads as directionless noise. The signed RWI (+high / −low) sorts strongest up-trends → range → strongest down-trends. |
| `STC` | `SCHAFF`, `TRENDCYCLE` | no | Schaff Trend Cycle board — per name, a 0–100 cyclical oscillator that runs a stochastic over the 23/50 MACD line, then a second smoothed stochastic over that, so it turns earlier than a plain MACD. ≥ 75 and rising flags a strengthening up-cycle, ≤ 25 a down-cycle; crosses of 25 / 75 are the common triggers. Shows the STC level, its bar-over-bar change, and the bull/bear/mid zone. |
| `TSI` | `TRUESTRENGTH`, `TSTRENGTH` | no | True Strength Index board — per name, William Blau's double-smoothed momentum: 100 × EMA(EMA(Δclose, 25), 13) ÷ EMA(EMA(\|Δclose\|, 25), 13), with a 7-EMA signal line. Bounded ≈ ±100; above zero is net positive (bullish) momentum, below zero bearish, ±25 the common overbought/oversold extremes, and a cross of the signal line the usual trigger. Shows the TSI, its distance from the signal, and the OB/OS/mid zone. |
| `CRSI` | `CONNORS`, `CONNORSRSI` | no | Connors RSI board — Larry Connors' short-term mean-reversion composite, the average of three 0–100 parts: a 3-period Wilder RSI of the close, a 2-period RSI of the consecutive up/down streak, and the percent-rank of today's 1-bar return over the last 100 bars. Below 10 is washed-out (oversold), above 90 over-extended. Shows the composite plus each component (RSI / STRK / %R). |
| `KST` | `KNOWSURETHING`, `PRING` | no | Know Sure Thing board — Martin Pring's summed rate-of-change momentum: four ROCs (10/15/20/30) each SMA-smoothed, then weighted 1·2·3·4 and added (raw, un-normalized), with a 9-SMA signal line. Oscillates around zero — above zero and above its signal is bullish momentum, below is bearish, and signal crossovers are the trigger. Shows the KST, its distance from the signal, and the above/below-signal and above/below-zero state. |
| `KVO` | `KLINGER`, `KVOL` | no | Klinger Volume Oscillator board — Stephen Klinger's volume-force oscillator: a signed force (volume × \|2·(dm/cm − 1)\| × trend × 100, dm the daily range and cm its trend-cumulative measurement) run through EMA(34) − EMA(55), with a 13-EMA signal. Above zero / above its signal is net accumulation, below is distribution; zero-line and signal crossovers are the triggers. Volume-normalised so symbols compare; shows the value, its distance from the signal, and the accumulation/distribution state. |
| `RVGI` | `RVI`, `VIGOR` | no | Relative Vigor Index board — John Ehlers' conviction gauge: a 1·2·2·1-smoothed (close − open) summed over N bars ÷ the same smoothing of (high − low), with a 1·2·2·1-weighted signal line. Reads where price closes within its range — closing near the high is bullish vigor, near the low bearish. Oscillates around zero (≈ ±1); above the signal is bullish, below bearish, and RVI/signal crossovers are the triggers. |
| `WT` | `WAVETREND`, `WAVE` | no | Wave Trend Oscillator board — LazyBear's double-smoothed CCI on the typical price (hlc3): a 10-EMA channel, its 0.015-scaled mean deviation, normalised and run through a 21-EMA (wt1), versus a 4-SMA signal (wt2). Oscillates around zero (≈ ±60) with overbought at +53/+60 and oversold at −53/−60; wt1 crossing wt2 and the zero line are the triggers. Shows the WaveTrend, its distance from the signal, and the OB/OS zone. |
| `SMI` | `STOCHMOM`, `BLAU` | no | Stochastic Momentum Index board — William Blau's refined stochastic: 200 × the double-EMA-smoothed distance of close from the range midpoint ÷ the double-EMA-smoothed range, on ±100, with an EMA signal. Less noisy than a plain stochastic; above +40 is overbought, below −40 oversold, and SMI/signal and zero-line crossovers are the triggers. Shows the SMI, its distance from the signal, and the OB/OS zone. |
| `RMI` | `RELMOM`, `MOMRSI` | no | Relative Momentum Index board — Roger Altman's RSI generalised to an M-bar momentum: instead of the 1-bar change it Wilder-smooths the up/down moves of close vs close M bars ago, on a 0–100 scale (length 20, momentum 5). Smoother and less whippy than RSI; > 70 overbought, < 30 oversold, and with momentum = 1 it is exactly a 20-period RSI. Shows the RMI, its bar-over-bar change, and the OB/OS zone. |
| `DOSC` | `DERIV`, `DERIVOSC` | no | Derivative Oscillator board — Constance Brown's refined RSI momentum: a 14-period Wilder RSI double-smoothed by EMAs (5 then 3), minus a 9-period simple moving average of that double-smoothed RSI, plotted as a histogram. Above zero (and rising) is bullish momentum, below zero bearish, and the zero-line and DO/signal crossovers are the triggers. Shows the DOSC histogram, whether it's rising or falling, and the bull/bear side. |
| `PSO` | `PREMIER`, `PREMSTOCH` | no | Premier Stochastic board — Lee Leibfarth's stochastic refined to a crisp ±1: a fast %K (length 8) is normalised to 0.1·(%K−50), double-EMA-smoothed (period 5), then squashed through (e^ss−1)/(e^ss+1) = tanh. The exponential sharpens turns — PSO sits near ±1 only on a sustained smoothed extreme; > +0.9 is strongly overbought, < −0.9 strongly oversold, and zero-line crossovers are the triggers. Shows the PSO, its bar-over-bar change, and the OB/OS zone. |
| `VHF` | `VERTHOR`, `VHFILTER` | no | Vertical Horizontal Filter board — Adam White's trend-vs-chop regime gauge: the N-bar close range ÷ the sum of \|bar-to-bar close moves\|, i.e. directional travel over total wiggle, on a 0–1 scale. High (≳ 0.35) means an efficient trend (favour trend-following tools); low (≲ 0.20) means choppy churn (favour oscillators); rising VHF = strengthening trend. Shows the VHF, its bar-over-bar change, and the trend/chop/mid regime. |
| `PGO` | `PRETTYGOOD`, `PGOSC` | no | Pretty Good Oscillator board — Mark Johnson's mean-distance gauge: (close − N-period SMA) ÷ an N-period EMA of the true range, so the reading is in ATR units and comparable across symbols. Above zero means price is above its mean (uptrend bias), below zero below it; ±3 are the momentum-breakout extremes (a stretch of three average ranges from the mean). Default look-back 89. Shows the PGO, its absolute stretch, and the ±3 zone. |
| `IMPULSE` | `ELDERIMPULSE`, `IMP` | no | Elder Impulse System board — Dr. Elder's regime censor combining the 13-period EMA slope (trend) with the MACD-histogram slope (momentum): green/bull when both rise, red/bear when both fall, blue/neutral when they disagree or either is flat. Green forbids shorting, red forbids buying, neutral permits both, so a fresh flip on the latest bar is the signal. Shows each symbol's impulse (with a ·new flip tag), its EMA slope %, and histogram %, with an all-bars / fresh-flips filter. |
| `DISP` | `DISPARITY`, `DI` | no | Disparity Index board — Steve Nison's mean-distance gauge: 100 × (close − N-period EMA) ÷ EMA, i.e. price's percentage distance from its moving average, comparable across symbols regardless of price. Above zero means price trades above its mean (uptrend bias), below zero below it; large readings flag over-extension from the mean. Default look-back 14, with a 14 / 25 toggle. Shows the DI, its absolute stretch, and which side of the mean price sits on. |
| `TII` | `TRENDINTENSITY`, `TRENDINT` | no | Trend Intensity Index board — M.H. Pee's trend-strength oscillator (0–100): over the last half-period window, sum the close's positive deviations above its simple major-period SMA versus the absolute negative deviations below, then 100 × SDpos / (SDpos + SDneg). Above 50 means positive deviations dominate (uptrend bias), below 50 the reverse, ~50 trendless; the 80 / 20 bands mark a strong trend. Default 60-SMA with a 30-bar window (60 / 30 toggle). Shows the TII, its bar-over-bar change, and the trend band. |
| `CKS` | `CHANDEKROLL`, `KROLL` | no | Chande Kroll Stop board — Chande & Kroll's two-stage ATR trailing stops: preliminary highStop = highestHigh(p) − x·ATR and lowStop = lowestLow(p) + x·ATR, then the final stopShort = highest(highStop, q) (upper band) and stopLong = lowest(lowStop, q) (lower band) using a Wilder ATR. Close above the upper band is an uptrend break, below the lower band a downtrend break, in between is range. Default ATR(10) / stop 9, with a 1× / 3× ATR toggle. Shows the regime and the % distance to each stop. |
| `KAMA` | `KAUFMAN`, `ADAPTIVEMA` | no | KAMA trend board — Kaufman's Adaptive Moving Average, an EMA whose smoothing constant scales with the Efficiency Ratio (net directional travel ÷ total path), so it tracks fast in clean trends and flattens in chop. SC = (ER·(fast − slow SC) + slow SC)², KAMA recurses toward price. Default ER 10 / fast 2 / slow 30, with a 10 / 20 ER-period toggle. Shows the KAMA slope direction, the Efficiency Ratio %, and the % distance of price from KAMA. |
| `SMIE` | `SMIERGODIC`, `ERGODIC` | no | SMI Ergodic board — William Blau's ergodic momentum, which is the True Strength Index (double-EMA-smoothed price change ÷ the same smoothing of its absolute value, ×100) paired with an EMA signal line; the histogram is the SMI Ergodic Oscillator. Above zero is net bullish momentum, below bearish, and a signal-line cross (histogram sign flip) is the trigger. Default long 20 / short 5 / signal 5, with a 20 / 12 long-period toggle. Shows the indicator, the histogram, and any fresh bull/bear cross. |
| `RBOW` | `RAINBOW`, `RAINBOWOSC` | no | Rainbow Oscillator board — Mel Widner's rainbow of ten recursively-smoothed 2-period SMAs of close (each band a 2-SMA of the previous), read two ways, both normalized by the recent high-low range: RO = 100·(close − rainbow average) ÷ range (positive above the rainbow / negative below), and the bandwidth = 100·(widest band − narrowest band) ÷ range (wide = strong trend, narrow = consolidation). Default 10 bands with a 10 / 20 range-lookback toggle. Shows the oscillator, the bandwidth, and which side of the rainbow price sits on. |
| `TTF` | `TRENDTRIGGER`, `TRIGGERFACTOR` | no | Trend Trigger Factor board — M.H. Pee's range-geometry oscillator comparing the most recent N-bar high/low range against the prior N bars: buyPower = recent highest high − prior lowest low; sellPower = prior highest high − recent lowest low; TTF = 100·(buyPower − sellPower) ÷ (0.5·(buyPower + sellPower)). It oscillates around 0 and beyond ±100 — above +100 is a strong uptrend (buy), below −100 a strong downtrend (sell), in between is neutral. Default lookback 15 (so 30 bars), with a 15 / 30 toggle. Shows the TTF, its magnitude, and the buy/sell/flat zone. |
| `INRT` | `INERTIA`, `RVI` | no | Inertia board — Donald Dorsey's trend-persistence gauge: the Relative Volatility Index (RSI's twin, fed the rolling standard deviation of price bucketed up/down by close direction and Wilder-smoothed) then smoothed by a linear-regression line. Above 50 is positive inertia (the longer-term trend is up / bullish and tends to persist), below 50 negative; it moves slowly. Default stdev 10 / RVI 14 / linreg 20, with a 20 / 10 linreg toggle. Shows the Inertia, the raw RVI, and the bull/bear side. |
| `VSTOP` | `VOLSTOP`, `VOLATILITYSTOP`, `WVS` | no | Volatility Stop board — the Wilder Volatility System in its canonical TradingView `ta.vstop` form: a ratcheting ATR trailing stop. The stop trails a multiple of a Wilder ATR below price in an up-trend and above it in a down-trend, only ever tightening within a leg and jumping to the other side of price when the trend flips (close crossing the stop). Price at or above the stop is long / up-trend, below is short; DIST% is the signed cushion from price to the stop. Default length 20 · factor 2 (ta.vstop), with a faster Wilder-classic 7 · 3 preset. Shows the direction, the stop level, the distance %, and a ✦ on a fresh flip. |
| `GAPO` | `GRI`, `RANGEINDEX`, `GOPALAKRISHNAN` | no | Gopalakrishnan Range Index board — Jayanthi Gopalakrishnan's log-scaled range gauge: GAPO = ln(highest high − lowest low over N) ÷ ln(N), an unbounded measure of how wide a symbol's recent range is (rising = range expanding / volatility up, falling = contracting). The raw value scales with price level, so the board screens cross-symbol on the scale-invariant RANGE% (range as a % of price) by default and offers a GAPO-expansion (slope) sort, while the canonical GAPO is still shown per symbol. Default lookback N 5, with a 5 / 14 toggle. Shows the GAPO, the RANGE%, and whether the range is expanding or contracting. |
| `RSL` | `RELATIVESTRENGTH`, `LEVY`, `RSLEVY` | no | Relative Strength (Levy) board — Robert Levy's RSL = close ÷ SMA(close, N), a momentum / trend ratio of price against its own moving average. Above 1 the price leads its average (strong), below 1 it lags (weak), 1.0 sits on the average. As a ratio of two same-scale prices it is naturally scale-invariant and ranks cleanly across symbols; DEV% restates it as the % above/below the average. Default lookback N 130 (Levy's ~27-week window), with a faster 50 preset. Shows the RSL, the DEV%, and the strong/weak side. |
| `VRSI` | `VERVOORT`, `SMOOTHEDRSI`, `IFTRSI` | no | Vervoort Smoothed RSI board — Sylvain Vervoort's Smoothed RSI Inverse Fisher Transform (S&C, Oct 2010): close → rainbow average (a 10-deep cascade of 2-period weighted MAs blended 5,4,3,2,1,1,1,1,1,1 ÷ 20) → Wilder RSI → centred 0.1·(RSI−50) → zero-lag EMA (2·EMA1 − EMA2) → inverse Fisher (tanh) into a (−1…+1) line that snaps sharply between extremes. ≥ +0.5 overbought, ≤ −0.5 oversold (entries cross up through −0.5 / down through +0.5). Default 4 bars for both the RSI and the zero-lag EMA, with an 8/8 smoother preset. Shows the VRSI, its rising/falling direction, and the overbought/oversold zone. |
| `HMA` | `HULL`, `HULLMA`, `HMASLOPE` | no | Hull MA Slope board — Alan Hull's low-lag MA = WMA(2·WMA(close, n/2) − WMA(close, n), round(√n)) with the linearly-weighted MA; the double-weighted half-length term minus the full term strips most of the lag, and the √n smoothing tames overshoot. The board screens by the HMA's slope: the raw per-bar change is in price units, so it sorts cross-symbol on the scale-invariant SLOPE% = 100·(HMA − prior HMA) ÷ prior HMA, with ▲ rising / ▼ falling from the sign. Default period 20, with a slower 55 preset. Shows the HMA, its percent slope, and the trend direction. |
| `PROJ` | `PROJECTION`, `POSC`, `PROJOSC` | no | Projection Oscillator board — Mel Widner's regression-slope-adjusted Stochastic. Over N bars it fits separate least-squares lines to the highs and lows and projects every bar forward along its own slope: PBU = max(high[i−k] + slopeH·k), PBL = min(low[i−k] + slopeL·k). PO = 100·(close − PBL) ÷ (PBU − PBL) is the close's position in that tilted band (0–100, 50 = mid), with a 5-period EMA trigger. Bounded 0–100 so it ranks cleanly across symbols; above 80 overbought, below 20 oversold. Default period 14, with a faster 7 preset. Shows the PO, its signal, the ▲/▼ trigger relation, and the OB/OS zone. |
| `MAMA` | `MESA`, `MAMAFAMA`, `ADAPTIVEMA` | no | MAMA / FAMA board — John Ehlers' MESA Adaptive Moving Average. A Hilbert-transform homodyne discriminator measures the dominant cycle and adapts the EMA smoothing α bar-by-bar (clamped 0.05–0.5); MAMA is the fast adaptive line and FAMA follows at half α, so MAMA leads in trends and the two cross in consolidations. MAMA above FAMA is bullish, below bearish, crossovers are signals. Sorts cross-symbol on the scale-invariant GAP% (MAMA − FAMA as a % of price), flags fresh crosses, and shows the live α. Default FastLimit 0.5 / SlowLimit 0.05, with a smoother 0.25 preset. Needs ≥ 40 bars of warm-up. |
| `T3` | `TILLSON`, `T3MA` | no | T3 Slope board — Tim Tillson's T3, a very smooth low-lag MA from nesting his generalized DEMA three times: GD(x) = EMA(x, N)·(1+v) − EMA(EMA(x, N), N)·v, T3 = GD(GD(GD(close))) (equivalently a fixed combination of six chained EMAs). The board screens by the T3's slope: the raw per-bar change is in price units, so it sorts cross-symbol on the scale-invariant SLOPE% = 100·(T3 − prior T3) ÷ prior T3, with ▲ rising / ▼ falling from the sign. Default period 5, volume factor v 0.7, with a smoother 14 preset. Shows the T3, its percent slope, and the trend direction. |
| `SINE` | `SINEWAVE`, `EHLERSSINE` | no | Ehlers Sinewave board — John Ehlers' Sine Wave Indicator. A Hilbert-transform homodyne discriminator measures the dominant cycle, then a correlation of the smoothed price gives the cycle phase, from which Sine = sin(phase) and LeadSine = sin(phase + 45°) are drawn (both −1…+1). LeadSine crossing above Sine is a cyclic up-turn, below a down-turn; in a trend the cycle degrades and the lines flatten and stop crossing. Bounded so they rank cleanly across symbols; sorts by LeadSine and flags fresh crosses. Fully adaptive (no parameters); needs ≥ 63 bars of warm-up. |
| `FRSI` | `FISHERRSI`, `FISHRSI`, `RSIFISHER` | no | Fisher Transform of RSI board — Ehlers' Fisher Transform fed the Wilder RSI of closes instead of price. Each symbol's RSI is normalized into its recent N-bar range, centred/smoothed (value = 0.66·(raw − 0.5) + 0.67·prior, clamp ±0.999), then Fisher-transformed (0.5·ln((1 + value) ÷ (1 − value)) + 0.5·prior) so turns are sharp. Screens how *stretched* RSI is within its own recent swing — a different lens than the absolute RSI board — with the underlying RSI shown for 70/30 context. Output saturates near ±3…±8 (not ±1), coloured by sign; TRIG = prior Fisher, a turn against it flags a reversal. Default RSI 9 / Fisher window 9, with a slower RSI 14 preset. |
| `TCF` | `TRENDCONT`, `CONTFACTOR`, `TCFACTOR` | no | Trend Continuation Factor board — M.H. Pee's TCF (S&C, March 2002), a trend-strength/direction filter used like ADX. Each bar's move splits into up/down parts; each direction accumulates a continuation factor that resets when the trend pauses, netted against the opposite run: +TCF = Σ(plus − CF_minus), −TCF = Σ(minus − CF_plus) over a window. +TCF > 0 = clean uptrend, −TCF > 0 = downtrend (never both); both ≤ 0 = consolidation. Computed on percent returns for cross-symbol comparability; sorts most-bullish first and flags the UP / DOWN / RANGE regime. Default length 35, faster 20 preset. Distinct from Pee's Trend *Trigger* Factor (TTF). |
| `CG` | `COG`, `CENTERGRAVITY`, `EHLERSCG` | no | Center of Gravity board — John Ehlers' CG oscillator (Cybernetic Analysis, 2004). Treats the last N median prices (H+L)/2 as a mass distribution and reports where their centre of gravity sits versus the window midpoint: CG = −Σ(1 + k)·price[k] ÷ Σ price[k] + (N + 1) ÷ 2 (price[k] = k bars ago). Centring on (N+1)/2 makes CG swing within ±(N−1)/2 around zero; as a price ratio it is dimensionless → inherently scale-invariant, ranking cleanly across symbols. Near-zero-lag and built to call turns: TRIG = prior CG, and a CG-vs-trigger cross (↑/↓) flags the reversal. Default length 10, with a smoother 20 preset. |
| `CORAL` | `CORALTREND`, `CRL` | no | Coral Trend board — LazyBear's Coral Trend Indicator. A six-stage zero-seeded recursive EMA cascade (smoothing from di = (length − 1)/2 + 1) combined with Tillson-T3 weights into a smooth, low-lag trend line: coral = −cd³·i6 + 3(cd²+cd³)·i5 − 3(2cd²+cd+cd³)·i4 + (3cd+1+cd³+3cd²)·i3. Trend = sign of coral vs its prior bar (rising = up/green, falling = down/red); a sign change is a flip. Screens trend STATE (not slope like the T3 board): sorts by signed trend persistence (longest uptrends first), shows DIST% of close from the coral line (scale-invariant), the AGE of the current trend in bars, and flags fresh flips. Default length 21 / cd 0.4, with a slower 34 preset. |
| `MCG` | `MCGINLEY`, `MGD`, `MCGINLEYDYNAMIC` | no | McGinley Dynamic board — John R. McGinley's self-adjusting MA. Seeded with the first close, then md = md_prev + (close − md_prev) ÷ (N · (close ÷ md_prev)^4): the fourth-power ratio swells the denominator when price is above the line (it crawls, refusing to chase rallies) and shrinks it when price is below (it catches declines fast), hugging price without the whipsaw of a fixed-period MA. Constant is plain N (the optional 0.6·N EMA-emulation scaling is not the default). The line is in price units, so the board screens scale-invariant DIST% (close vs the line), SLOPE% (the line's trend), and up/down direction — sorting by how far price has stretched above its adaptive baseline. Default period 14, with a slower 22 preset. |
| `VIDYA` | `CHANDEVIDYA`, `VAR` | no | Chande VIDYA board — Tushar Chande's Variable Index Dynamic Average, an EMA whose smoothing is scaled by a volatility index so it tracks fast in trends and flattens in chop: k = |CMO(N)| ÷ 100, alpha = 2 ÷ (N + 1), VIDYA = alpha·k·close + (1 − alpha·k)·VIDYA_prev. \|CMO\| ≈ 100 → behaves like EMA(N); \|CMO\| ≈ 0 → line barely moves. One period N drives both the CMO and alpha; seeded with the SMA of the first N closes (the canonical CMO-VIDYA seed, distinct from the std-dev-ratio VIDYA). Line is in price units, so the board screens scale-invariant DIST% (close vs the line), SLOPE% (the line's trend) and the underlying CMO driver, sorting by how far price has stretched above the line. Default period 9, with a slower 14 preset. |
| `GHLA` | `GANNHILO`, `HILOACTIVATOR`, `GANN` | no | Gann HiLo Activator board — Robert Krausz's stop-and-reverse trend line from SMA(high) and SMA(low). Close above the prior bar's high-SMA → trend up (activator = low-SMA, support below price); close below the prior low-SMA → down (activator = high-SMA, resistance above); else carry. A close piercing the opposite band flips it. Screens trend STATE (not slope): sorts by signed trend persistence (longest uptrends first), shows DIST% of close from the activator/stop (scale-invariant), the AGE of the current trend in bars, and flags fresh flips. Default period 3 (Krausz), with a slower 10 preset. |
| `CYBER` | `CYBERCYCLE`, `CC`, `EHLERSCYCLE` | no | Ehlers Cyber Cycle board — John Ehlers' dominant-cycle oscillator (Cybernetic Analysis, 2004). A 4-bar FIR smoother of the median ((H+L)/2, weights 1,2,2,1÷6) feeds a 2nd-order recursive band-pass: Cycle = (1−½α)²·(Smooth − 2·Smooth[1] + Smooth[2]) + 2(1−α)·Cycle[1] − (1−α)²·Cycle[2], α 0.07; the first six bars use Ehlers' warm-up second difference, recursion begins on the seventh. The raw cycle scales with price, so the board reports it as a percent of price (scale-invariant); TRIG% = prior cycle, and a cycle-vs-trigger cross (↑/↓) marks a cyclic turn. Default α 0.07, with a faster 0.14 preset. |
| `RVI` | `RELVOL`, `RVOL`, `RELVOLATILITY` | no | Relative Volatility Index board — Donald Dorsey's RVI (S&C, 1993), RSI's twin fed the VOLATILITY of price rather than the price change. Each bar's rolling std-dev of close is routed to an up bucket when price rose or a down bucket when it fell, then Wilder-smoothed into RVI = 100·avgUp ÷ (avgUp + avgDown), bounded 0–100. Above 50 = volatility expanding on up moves (bullish confirmation), below 50 on down moves; OB/OS guides at 60/40. A confirmation filter alongside trend indicators. Shares its RVI core with the Inertia board (INRT). Default stdev 10 / smoothing 14, with a slower 21 preset. Distinct from the Relative Vigor Index (RVGI). |
| `ROOF` | `ROOFING`, `ROOFINGFILTER`, `EHLERSROOF` | no | Ehlers Roofing Filter board — John Ehlers' band-pass "roof" (Cycle Analytics for Traders, 2013) passing only the tradable cycle band. A two-pole high-pass (cutoff 48) strips the trend, a two-pole SuperSmoother low-pass (cutoff 10) strips the noise: HP = (1−½α₁)²·(C − 2·C[1] + C[2]) + 2(1−α₁)·HP[1] − (1−α₁)²·HP[2]; Filt = c1·(HP + HP[1])/2 + c2·Filt[1] + c3·Filt[2] (degree-convention trig, full-π SuperSmoother coefficients). The raw filter's amplitude scales with each symbol's volatility, so the board AGC-normalizes it to ±1 (peak = max(\|Filt\|, 0.991·peak)) for cross-symbol ranking — > 0 = up phase, < 0 = down phase, and a cross past the prior-bar trigger (▲ bull trough / ▼ bear peak) marks a cyclic turn. Default HP 48 / SS 10, with a smoother 20 preset. Formula, degree convention and warm-up confirmed against Ehlers' source by a multi-agent workflow with a machine-precision fixture. |
| `PFE` | `POLARIZED`, `PFEFF`, `FRACTALEFF` | no | Polarized Fractal Efficiency board — Hans Hannula's PFE (S&C, 1994): how efficient / directional price travel is — the straight-line distance over N bars vs the jagged path actually taken, polarized by net direction. straightLine = √((C − C[N])² + N²); pathLength = Σ √((C[i] − C[i−1])² + 1); PFE = sign(C − C[N]) · 100 · straightLine ÷ pathLength, EMA-smoothed (α = 2/(M+1)). Bounded exactly ±100 — near +100 = clean efficient up-trend, deep −100 = clean down-trend, ≈ 0 = choppy. The raw formula mixes price units with bar-count units so it is NOT scale-invariant (sub-dollar coins saturate to ±100, expensive coins compress); the board rebases each N-bar window into %-space (anchor C[t−N], reference 100 so a 1 % bar ≈ 1 vertical unit) before computing, making it fair across crypto of any price. Screens signed PFE, \|PFE\| strength and a trend/chop zone at ±50. Default lookback 10 / EMA 5, with a slower 20 preset. Formula, EMA seeding and scale-invariance fix confirmed by a multi-agent workflow with a machine-precision fixture. |
| `ALMA` | `ARNAUD`, `LEGOUX`, `ARNAUDLEGOUX` | no | Arnaud Legoux Moving Average board — ALMA (Arnaud Legoux & Dimitris Kouzis-Loukas), a Gaussian-weighted FIR whose weight peak is slid toward the recent end of the window for a low-lag yet smooth line: m = offset·(N−1); s = N ÷ sigma; w[i] = exp(−(i−m)² ÷ (2·s²)) over the trailing window oldest→newest; ALMA = Σ w[i]·price[i] ÷ Σ w[i]. offset near 1 puts the weight peak on recent bars (responsive), near 0 on older bars (smooth); m is left unfloored by default to match TradingView's ta.alma. ALMA is a price-unit line, so the board screens scale-invariant SLOPE% (line trend) and DIST% (price vs the line) with a rising/falling direction — the same convention as the Hull / McGinley / VIDYA boards. Default window 9 / offset 0.85 / sigma 6, with a slower 21 preset. Formula, floor convention and indexing confirmed against TradingView's reference by a multi-agent workflow with a machine-precision fixture. |
| `CVOL` | `CHAIKINVOL`, `CVOLATILITY`, `CHAIKINVOLATILITY` | no | Chaikin Volatility board — Marc Chaikin's gauge of how fast the trading range is expanding or contracting. EMAs the high−low range, then takes its percent rate-of-change: range = high − low; emaHL = EMA(range, N); CVOL = 100·(emaHL − emaHL[N ago]) ÷ emaHL[N ago]. Positive = smoothed range wider than N bars ago → volatility EXPANDING (tops / breakouts); negative = CONTRACTING (consolidation). A percent rate-of-change so the price units cancel — inherently scale-invariant, ranks cleanly across symbols. Default EMA 10 / ROC 10, with a slower 21 preset; sorts fastest-expanding first. Distinct from Chaikin Money Flow (CMF) and the A/D line (ADL). |
| `STRSI` | `STOCHRSI`, `SRSI`, `STOCHASTICRSI` | no | Stochastic RSI board — Chande & Kroll's StochRSI (1994), a Stochastic oscillator applied to the RSI series instead of to price: rsi = Wilder RSI(close, N); raw = 100·(rsi − min(rsi, M)) ÷ (max(rsi, M) − min(rsi, M)); %K = SMA(raw, 3); %D = SMA(%K, 3). Far more sensitive than plain RSI — it reaches the 0–100 extremes much more often, a faster overbought/oversold and reversal-timing tool (OB ≥ 80, OS ≤ 20). Bounded and built from RSI, so inherently scale-invariant; a flat RSI window reads 0. Default RSI 14 / Stoch 14 / K 3 / D 3, with a slower 21 preset; reuses the repo's Wilder RSI core. Distinct from the RSI, Stochastic (STOCH), Connors RSI (CRSI) and RMI boards. |
| `TDS` | `TDSETUP`, `TDSEQ`, `DEMARK` | no | TD Sequential Setup board — the first phase of Tom DeMark's TD Sequential, a price-exhaustion counter. A TD Buy Setup is 9 consecutive closes below the close 4 bars earlier (stretched toward a bottom); a TD Sell Setup is 9 consecutive closes above the close 4 bars earlier (toward a top). The count runs 1→9, resetting when a close breaks the relationship (the reset bar = DeMark's TD Price Flip), and clamps at 9 when complete. 'Perfection' = a buy's bar-8/9 low ≤ bars 6 & 7 lows (sell: bar-8/9 high ≥ bars 6 & 7 highs), the tail making a fresh extreme. Closes drive the scale-free count, so it ranks across symbols. Screens direction (BUY = potential bottom / SELL = potential top), the 1–9 count and a perfected ★; sorts highest count first. |
| `DEM` | `DEMARKER`, `DMARK`, `DMK` | no | DeMarker board — Tom DeMark's DeMarker (DeM), a bounded 0–100 momentum oscillator that reads the highs/lows (not the close): DeMax = high − high[1] when the high makes a new high (else 0); DeMin = low[1] − low when the low makes a new low (else 0); DEM = 100·SMA(DeMax, N) ÷ (SMA(DeMax, N) + SMA(DeMin, N)). Demand vs supply — above 70 = overbought / exhaustion risk, below 30 = oversold, often leading price at turns. The ratio cancels price units → inherently scale-invariant; a perfectly flat window reads 50. Default period 14, with a slower 21 preset. Distinct from the RSI / StochRSI boards (which read closes) and the TD Sequential Setup (TDS) counter. |
| `ZLEMA` | `ZEROLAG`, `ZEROLAGEMA`, `ZLE` | no | Zero-Lag EMA board — Ehlers & Way's Zero-Lag EMA, an EMA fed a de-lagged input so it tracks price with almost no delay: lag = floor((N−1) ÷ 2); deLagged = 2·price − price[lag]; ZLEMA = EMA(deLagged, N). Adding the (price − price[lag]) momentum term shifts the line forward, cancelling most of an EMA's lag while keeping its smoothing — a fast, responsive trend line. A price-unit line, so the board screens scale-invariant SLOPE% (line trend) and DIST% (price vs the line) with a rising/falling direction — the same convention as the Hull / ALMA / McGinley / VIDYA boards. Default period 14, with a slower 34 preset; sorts strongest rising first. |
| `TDC` | `TDCOUNTDOWN`, `COUNTDOWN`, `TDCD` | no | TD Sequential Countdown board — phase 2 of Tom DeMark's TD Sequential, begun once a TD Setup completes (9). Unlike the Setup's consecutive count, the Countdown accumulates non-consecutive qualifying bars toward 13: a TD Buy Countdown (after a buy setup) counts each bar whose close ≤ the low 2 bars earlier; a TD Sell Countdown counts each bar whose close ≥ the high 2 bars earlier. The 13th only lands when the bar's low ≤ countdown-bar-8's close (sell: high ≥ bar 8's close) — else it holds at 12 (deferred, shown 12+). A completed 13 marks deeper exhaustion beyond the Setup's 9; an opposite setup completing cancels and flips it. Scale-free (close vs high/low). Screens direction (BUY = potential bottom / SELL = potential top), the 1–13 count and a completed ✓; sorts highest count first. Complements the TD Setup (TDS) board — Setup arms, Countdown confirms. |
| `GATOR` | `ALLIGATOR`, `WILLIAMSALLIGATOR`, `GATR` | no | Williams Alligator board — Bill Williams' Alligator, three smoothed MAs of the median price ((high + low) ÷ 2), each shifted forward: Jaw (SMMA 13, displaced 8), Teeth (SMMA 8, displaced 5), Lips (SMMA 5, displaced 3); SMMA is Wilder's smoothed MA. Intertwined lines = the alligator sleeps (range); fanned and ordered = it feeds — Lips > Teeth > Jaw is an uptrend, Lips < Teeth < Jaw a downtrend. Screens the trend state (FEED ↑ / FEED ↓ / SLEEP) and the fan width SPREAD% = 100·(Lips − Jaw) ÷ median — scale-invariant, so a wide positive fan ranks as the strongest uptrend, wide negative the strongest downtrend, near zero asleep. Williams' fixed 13/8/5 periods with 8/5/3 displacements; sorts strongest up-fan first. |
| `AO` | `AWESOME`, `AWESOMEOSC`, `AOSC` | no | Awesome Oscillator board — Bill Williams' AO, the difference of two SMAs of the median price ((high + low) ÷ 2): AO = SMA(median, 5) − SMA(median, 34). A zero-line momentum histogram of market 'force' — above zero = bullish, below = bearish; each bar is green when AO rises vs the prior bar (momentum building) or red when it falls (saucer / twin-peaks signals). AO is in price units, so the board ranks on AO% = 100·AO ÷ median (scale-invariant); the BAR column shows the rising/falling histogram colour. Default 5 / 34, with a slower 8 / 55 preset. Pairs with the Williams Alligator (GATOR). Sorts highest AO% first. |
| `AC` | `ACCEL`, `ACCELERATOR`, `ACCELOSC` | no | Accelerator Oscillator board — Bill Williams' AC, the acceleration of momentum: AC = AO − SMA(AO, 5), where AO = SMA(median, 5) − SMA(median, 34) on the median price ((high + low) ÷ 2). It measures whether the force behind price is speeding up or slowing down — because force precedes price, the AC turns before the AO does, so its zero cross is an earlier signal. Each bar is green when AC rises vs the prior bar, red when it falls (Williams: buy only on green bars, sell only on red). AC is in price units, so the board ranks on AC% = 100·AC ÷ median (scale-invariant); the BAR column shows the rising/falling histogram colour. Signal SMA fixed at 5; default AO 5 / 34, with a slower 8 / 55 preset. Completes the Bill Williams trio with the Alligator (GATOR) and Awesome Oscillator (AO). Sorts highest AC% first. |
| `CHO` | `CHAIKINOSC`, `CHAIKINOSCILLATOR`, `CHADOSC` | no | Chaikin Oscillator board — Marc Chaikin's oscillator, the momentum of the Accumulation/Distribution Line (ADL): CHO = EMA(ADL, 3) − EMA(ADL, 10), where ADL accumulates moneyFlowMultiplier · volume (the multiplier ((close − low) − (high − close)) ÷ (high − low) weights volume by where the close sits in the range). The MACD idea applied to volume flow instead of price — above zero the ADL's short EMA leads its long EMA (accumulation building), below zero distribution; zero-line crossovers and divergence from price are the signals, and each bar is green when the oscillator rises vs the prior bar, red when it falls. Since the ADL scales with volume, the board ranks on CHO ÷ average volume (the multiplier is already price-scale-free) — the same volume-normalised convention as the Klinger (KVO) board. Default 3 / 10, with a slower 6 / 20 preset. Completes the Chaikin family with Money Flow (CMF) and Volatility (CVOL); distinct from those and from the ADL, KVO and OBV boards. Sorts most bullish first. |
| `ALERT` | `ALRT`, `AL`   | optional     | Price / funding / 24h%-change alerts (above · below · cross), **local or server-backed** → toast / desktop, and an optional **on-fire action** that opens a panel (chart / description / order book / derivatives) for the symbol. |
| `ACCT`  | `ACCOUNT`      | no           | Manage your account — password, sessions, and (admin) users.|
| `PREF`  | `SETTINGS`, `SET`, `CONFIG` | no | Terminal preferences — density, ticker, default chart timeframe, alert sound/desktop. Saved to your browser. |
| `REPORT`| `EXPORT`, `CSV` | no         | Export your data to CSV — trade journal, transactions, positions, alert triggers and watchlists. |
| `NOTE`  | `NOTES`, `JRNL`, `MEMO` | no  | Free-form notes — global or per symbol, synced to your account.|
| `RISK`  | `SIZER`, `SIZE` | no          | Risk-based position sizer — size from account, risk %, entry & stop, with R-targets & liq. estimate. |
| `CONV`  | `NOTIONAL`, `CONVERT` | yes    | Size / notional converter — convert between quantity, notional, % of account and margin at the live price. |
| `KELLY` | `BETSIZE`, `OPTIMALF`, `KCRIT` | no | Kelly-criterion bet sizing — optimal bankroll fraction from win rate & payoff, with half/quarter Kelly, expectancy & breakeven win. |
| `ROR`   | `RUIN`, `RISKOFRUIN`, `ROFR` | no | Risk-of-ruin simulator — probability of blowing up from win rate, payoff & risk-per-trade, with expected max drawdown & a survival curve. |
| `LADDER` | `SCALEIN`, `RUNGS`, `SCALE` | no | Scale-in ladder planner — spread a budget across limit rungs over a price range (flat/linear/geometric) for a blended average entry. |
| `DCA`   | `AVG`, `AVERAGE`, `BASIS` | no | Average-cost calculator — blend fills into an average entry, mark P&L, liq. estimate + target-average solver. |
| `LOG`   | `JOURNAL`, `TJ` | no         | Trade journal — log entries/exits, score R-multiples, track win rate, expectancy & total R. Saved to your browser. |
| `EQ`    | `EQUITY`, `CURVE`, `DRAWDOWN` | no | Equity curve — cumulative R, max drawdown and streaks from your scored journal trades. |
| `PNL`   | `FEE`, `ROE`   | no           | Trade P&L & fee calculator — gross/net P&L, ROE, fees paid and fee-inclusive break-even. |
| `N`     | `NEWS`, `CN`   | optional     | Headlines for a symbol (or market if omitted).|
| `TOP`   | `MKT`          | no           | Top market-wide news.                         |
| `SECF`  | `FIND`, `SRCH` | no           | Search for securities by ticker or name.      |
| `BOARDS` | `CATALOG`, `SCREENS`, `INDICATORS` | no | Screener catalog — one searchable, categorized directory of every indicator/analytics board (Momentum, Trend, Volatility, Volume, Cycles, Risk & Performance). Type to filter, click a code to open — instead of memorizing ~115 mnemonics. Derived from the command registry itself. |
| `HELP`  | `H`, `?`       | no           | Command list and usage.                       |

**Grammar:** `BTC/USDT` → description · `BTC/USDT GP` → chart · `BTC/USDT BOOK` → order book ·
bare `W`/`HELP` → symbol-less panels · unrecognized text → security search.

**Keyboard:** start typing anywhere to focus the command line · `↑/↓` recall
history or move through suggestions · `Tab` complete · `Esc` clear.

**Shortcuts:** `⌘K` / `Ctrl-K` command palette · `⌥1…⌥9` focus a panel by its
number · `⌥]` / `⌥[` focus next / previous · `⌥W` close the focused panel ·
`?` shows the full list (`⌥` = Alt / Option).

---

## Architecture

A pnpm monorepo with a typed contract shared by client and server.

```
midas/
├── packages/
│   └── shared/        @midas/shared — Quote, Candle, NewsItem… (the data contract)
├── apps/
│   ├── server/        @midas/server — Fastify API + pluggable data providers
│   │   └── src/providers/   DataProvider interface · MockProvider · YahooProvider
│   └── web/           @midas/web — React + Vite terminal UI
│       └── src/
│           ├── commands/    command registry, parser, executor
│           ├── store/       zustand stores (panels, watchlist) — persisted
│           ├── modules/     panel modules (DES, GP, W, Q, N, SECF, HELP)
│           └── components/  TopBar, CommandBar, Workspace, Panel, Ticker…
```

**Data flow:** the web client calls `/api/*` → Fastify routes → the active
`DataProvider`. In dev, Vite proxies `/api` to the server. Adding a data source
means implementing one interface (`apps/server/src/providers/types.ts`); adding
a panel type means writing a module component and registering it.

### API

| Route                              | Returns                          |
| ---------------------------------- | -------------------------------- |
| `GET /api/health`                  | provider id, live flag, version  |
| `GET /api/quote/:symbol`           | `Quote`                          |
| `GET /api/quotes?symbols=A,B,C`    | `Quote[]`                        |
| `GET /api/history/:symbol`         | `HistoryResponse` (OHLCV candles)|
| `GET /api/funding?quote=&limit=`   | `FundingRow[]` (top perps' funding + OI)|
| `GET /api/liquidations?quote=&limit=` | `LiquidationEvent[]` (market-wide feed)|
| `GET /api/search?q=`               | `SearchResult[]`                 |
| `GET /api/news?symbol=`            | `NewsItem[]`                     |
| `GET/POST/PATCH/DELETE /api/alerts` | server-side alert rules (CRUD)  |
| `GET /api/alerts/log`              | recent server-fired triggers     |
| `GET/PUT /api/workspaces`          | the user's synced workspace layout|
| `GET/PUT /api/portfolio`           | the user's synced paper portfolio |
| `GET/PUT /api/watchlists`          | the user's synced named watchlists|
| `GET/PUT /api/notes`               | the user's synced notes          |
| `GET /api/balances`                | read-only account balances (keyed) |
| `GET /api/orders` · `GET /api/positions` · `GET /api/fills?symbol=` | read-only open orders / positions / executions |
| `GET /api/orders/:id?symbol=`      | read-only single-order lookup (TICKET tracking) |
| `GET /api/account/events?since=`   | account watcher feed (fills/cancels observed) |
| `GET /api/trading/status`          | whether live trading is enabled, caps, usage |
| `POST /api/orders` · `DELETE /api/orders/:id` | the ONLY two writes — gated, capped, audited |
| `GET /api/auth/status`             | whether auth is on / signup open |
| `POST /api/auth/signup\|login`     | create a session (returns a token)|
| `GET /api/auth/me`                 | the signed-in user (bearer token)|
| `POST /api/auth/password`          | change password (rotates other sessions)|
| `POST /api/auth/logout-all`        | sign out other devices (token rotation)|
| `GET/DELETE /api/auth/users`       | admin: list / remove accounts    |

`/api/history` accepts `interval` (`1m`…`1mo`) and `range` (`1d`…`max`).

The server also runs a **background alert engine**: it evaluates the stored
alert rules on a timer using the active provider and records fires — so alerts
keep evaluating even with no browser open. Rules + triggers persist to
`MIDAS_ALERTS_FILE` (the `midas-data` volume under Docker). Set
`MIDAS_ALERT_WEBHOOK` to **POST fires to a webhook** (a Discord or Slack
incoming-webhook URL works as-is) for delivery with no terminal open at all.
The `ALERT` panel's **Server** mode manages these rules, and its ⚡ row arms
the classic setups in one click (funding flip, ±5% day move, 5% equity
drawdown). The same webhook can carry a periodic **operator digest**
(`MIDAS_DIGEST_HOURS=24` for a daily P&L recap): equity change since the last
digest, fills with round-trip realized P&L and fees, the biggest movers among
your position symbols, plus alerts fired and order flow observed.

With **auth enabled**, the terminal also **syncs each user's workspaces, paper
portfolio, watchlists and notes** to the server (`GET/PUT /api/workspaces`,
`/api/portfolio`, `/api/watchlists`, `/api/notes`): your panels, saved layouts,
positions, trade journal, named watchlists and notes are pushed (debounced) as
you change them and pulled back on login, so your whole setup follows your
account across devices. Each snapshot is an opaque blob the server stores per
user; with auth off the terminal keeps using local storage only, unchanged.

---

## Configuration

Server (environment variables):

| Variable              | Default     | Description                          |
| --------------------- | ----------- | ------------------------------------ |
| `MIDAS_DATA_PROVIDER` | `mock`      | `mock`, `yahoo`, or `ccxt`.          |
| `MIDAS_CCXT_EXCHANGE` | `binance`   | Exchange id when provider is `ccxt`. |
| `MIDAS_CCXT_API_KEY`  | _(unset)_   | **Read-only** exchange API key for live account balances (`BAL`). Non-custodial: Midas only ever reads (`fetchBalance`) — it never places orders or moves funds. Leave unset to keep balances in synthetic demo mode. |
| `MIDAS_CCXT_SECRET`   | _(unset)_   | Secret paired with `MIDAS_CCXT_API_KEY`. Both must be set to enable live balances. |
| `MIDAS_CCXT_PASSWORD` | _(unset)_   | API passphrase, only for venues that require one (e.g. OKX, KuCoin). |
| `MIDAS_CCXT_EXCHANGE_2` (+ `_API_KEY_2`, `_SECRET_2`, `_PASSWORD_2`) | _(unset)_ | Optional **second keyed venue**: `BAL`/`ORD`/`POSN`/`FILLS` merge both accounts, tagging each row with its venue. Read-only; the trading write path never touches it. |
| `MIDAS_ACCOUNT_WATCH_MS` | `10000`  | With keys set, a **read-only** watcher polls open orders at this cadence and turns changes into fill notifications (terminal toasts + the alert webhook). `0` = off; floored at `2000` to protect exchange rate limits. |
| `MIDAS_DEX_SOURCE`    | _(unset)_   | Set to `dexscreener` or `geckoterminal` to read live on-chain/DEX pools (`DEX`) from a public API; otherwise DEX data is honestly labeled unavailable. |
| `PORT`                | `4000`      | API port.                           |
| `HOST`                | `0.0.0.0`   | API bind host.                      |
| `MIDAS_CORS_ORIGIN`   | `*`         | Allowed CORS origin.                |
| `MIDAS_KEYS_KMS_SECRET` | _(unset)_ | Enables **per-user exchange keys** (hosted tier): signed-in users store their own keys (`PUT /api/account/keys`) — encrypted at rest with this secret, never returned after write. Account panels then read *their* account; keys saved with `canTrade: true` may trade on *their* account behind every gate above, with a per-user daily budget. A user's writes can only ever touch the account their reads come from. Needs `MIDAS_AUTH_ENABLED=true`. |
| `MIDAS_MAX_KEYED_USERS` | `25`      | Keyed users allowed to run per-user background loops (fill watcher + equity snapshots). Beyond the cap, reads still work per-request; the events/equity panels say loops are off. |
| `MIDAS_RATE_LIMIT_RPM` | `0`        | Per-IP request ceiling (requests/minute). `0` = off; demo mode defaults to `120`. `/api/health` is exempt. |
| `MIDAS_DEMO_MODE`     | `false`     | **Public-demo posture**: forces mock data, disables live trading (both switches) and closes signups — regardless of everything else. Makes an instance safe to expose as a try-before-you-buy demo. |
| `LOG_LEVEL`           | `info`      | Pino log level.                     |
| `ANTHROPIC_API_KEY`   | —           | Enables the AI copilot (`AI`).       |
| `MIDAS_AI_MODEL`      | `claude-sonnet-4-6` | Claude model for the copilot.|
| `MIDAS_DATA_DIR`      | `./data`    | Where server state (alerts, users, workspaces, portfolios, watchlists, notes) is stored.|
| `MIDAS_ALERT_INTERVAL_MS` | `15000` | Background alert evaluation cadence.  |
| `MIDAS_ALERT_WEBHOOK` | —           | POST fired alerts here (Discord/Slack/custom).|
| `MIDAS_DIGEST_HOURS`  | `0`         | Operator digest: every N hours, POST a P&L recap (equity change, fills + round-trip P&L, top movers) plus alerts fired + order flow to the webhook (`24` = daily, `168` = weekly, `0` = off, floored at 1). |
| `MIDAS_EQUITY_SNAP_MS` | `3600000`  | Account equity snapshot cadence for the `AEQ` curve (read-only; persisted in the data dir). `0` = off; floored at `60000`. |
| `MIDAS_AUTH_ENABLED`  | `false`     | Require login (bearer token) for the API.|
| `MIDAS_AUTH_ALLOW_SIGNUP` | `true`  | Allow new accounts (first user always can).|
| `MIDAS_AUTH_SECRET`   | —           | Secret for signing session tokens.   |
| `MIDAS_TRADING_ENABLED` | `false`   | **Master switch for LIVE order placement (`TICKET`). Off by default.** When `true` (and the ccxt provider has trade-permissioned keys, and auth is on) the order ticket can place real orders. |
| `MIDAS_MAX_ORDER_USD` | `1000`      | Hard per-order notional cap the server enforces; orders above it are rejected. `0` = uncapped (not recommended). |
| `MIDAS_MAX_DAILY_USD` | `5000`      | Cumulative UTC-day notional cap across all orders — bounds a whole session's exposure, not just one order. In-memory (resets on restart). `0` = uncapped. |
| `MIDAS_TRADING_ALLOW_NO_AUTH` | `false` | Escape hatch to allow trading without login on a trusted single-user/localhost host. Leave off; enabling it on a network-reachable instance is dangerous. Requires a pinned `MIDAS_CORS_ORIGIN` (not `*`) — the server refuses no-auth trading with wildcard CORS to avoid cross-site order placement. |

### Live trading (opt-in, off by default)

Midas is read-only and non-custodial unless you deliberately turn trading on.
Order placement (the `TICKET` panel) stays a preview until **every** gate passes:

1. `MIDAS_TRADING_ENABLED=true` (master switch), **and**
2. the `ccxt` provider with **trade-permissioned** `MIDAS_CCXT_API_KEY` / `MIDAS_CCXT_SECRET`, **and**
3. `MIDAS_AUTH_ENABLED=true` (or the explicit `MIDAS_TRADING_ALLOW_NO_AUTH=true` override on a trusted host).

Even then, every order is validated and capped at `MIDAS_MAX_ORDER_USD` server-side,
the panel shows a red **LIVE** banner, and placement requires a two-step confirm.
The single `createOrder` call is the only write in Midas; keys never leave your
server. Trading on a network-exposed instance without auth is strongly discouraged —
see [SECURITY.md](./SECURITY.md).

Web (build-time): `VITE_API_TARGET` (dev proxy target),
`VITE_API_BASE` (API base URL when hosted separately).

---

## Scripts

```bash
pnpm dev          # run web + API in parallel
pnpm dev:web      # web only
pnpm dev:server   # API only
pnpm build        # build all packages
pnpm typecheck    # typecheck all packages
pnpm test         # run the unit + API test suite (Vitest)
pnpm start        # run the API (after configuring a provider)
```

---

## Tech stack

React 18 · Vite · TypeScript · Tailwind CSS · Zustand · react-grid-layout ·
TradingView lightweight-charts · Fastify · pnpm workspaces.

---

## Roadmap

Midas is a full crypto-native terminal: command line + tiling panels, charts and
microstructure, derivatives, ~115 indicator/analytics boards, screening, alerts,
portfolio, an on-chain/DEX read layer, and a complete **non-custodial account &
execution suite** (read-only by default; live trading strictly opt-in behind
caps and confirms) — all behind a data-honesty guarantee. It ships from `main`.

Where it's heading (open-core, open-source first) — the detailed 30-day plan
lives in [`docs/ROADMAP.md`](./docs/ROADMAP.md):

- **Order lifecycle depth:** fill notifications, order-status tracking, and
  post-trade analytics (realized slippage vs the preview).
- **Live data depth:** more first-class live sources behind the honest seam,
  never mislabeling provenance.
- **Distribution & DX:** stay genuinely open and easy to adopt — strong docs, a
  one-command demo, contributor-friendly internals.
- **Optional hosted tier:** a zero-setup instance for people who don't want to
  self-host, funding the open core (the terminal stays free and open).

Have an idea or want a board? Open an issue — see [CONTRIBUTING](./CONTRIBUTING.md).

---

## Hosted Midas — $20/month flat

Self-hosting is free forever — that never changes. For traders who'd rather not
run a server, a **hosted tier is coming**: your own Midas instance, managed and
updated for you, **$20/month flat** — no seat math, no per-panel pricing, no
"pro" gating. The same open-source terminal, someone else on pager duty.

Compare: a Bloomberg seat runs ~$2,400/month; mainstream charting platforms
charge $30–60/month and still meter your indicators, alerts and layouts. Midas
gives you every panel, every board, unlimited alerts and live execution
tooling — self-hosted for $0, or hosted for less than most people's exchange
fees in a week.

Planned tiers (waitlist replies size the split): **$20/mo solo** — one venue,
full terminal, alerts + digests; **$49/mo desk** — two venues, multi-user,
trading gates. Self-hosting always includes everything.

**[→ Join the waitlist](https://github.com/ayyitskevin/midas/issues/new?title=Hosted+Midas+waitlist&body=Add+me+to+the+hosted-tier+waitlist.+%28Optional%3A+which+exchange%28s%29+do+you+trade%3F%29&labels=hosted-waitlist)**
— it's a GitHub issue; a 👍 on an existing waitlist issue counts too. Nothing
is billed today; the waitlist is how we size the first cohort.

---

## License

MIT — see [LICENSE](./LICENSE).
