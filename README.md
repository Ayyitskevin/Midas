# MIDAS

A self-hosted, **Bloomberg-style market terminal** you run yourself. Type
mnemonic commands (`AAPL DES`, `NVDA GP`, `W`, `N`) into a command line to spawn
tiling panels — quotes, charts, watchlists, news — across a dense, dark
workspace. Inspired by [Gödel Terminal](https://godelterminal.com).

> Status: **v0.1 — foundation.** A working end-to-end vertical slice (command
> bar → tiling panels → live-updating modules → pluggable data backend). Built
> to grow for months. See the [Roadmap](#roadmap).
>
> **Direction:** Midas is heading toward a command-driven, self-hosted,
> **crypto-native** terminal (CCXT, no API keys). See [`VISION.md`](./VISION.md)
> and the [competitive teardown](./docs/research/godel-competitive-teardown.md).

---

## Highlights

- **Command-driven UI.** A Bloomberg-style command line with history,
  fuzzy autocomplete and "type anywhere to focus." `TICKER FUNCTION` grammar.
  A **⌘K / Ctrl-K command palette** fuzzy-jumps to any command or symbol.
- **Tiling panel workspace.** Drag, resize and arrange panels on a 12-column
  grid. Layout + watchlist persist in your browser.
- **Starter modules:** Description/quote (`DES`), price chart (`GP`/`GIP`),
  watchlist (`W`), quote monitor (`Q`), news (`N`/`TOP`), security finder
  (`SECF`), help (`HELP`).
- **Pluggable data layer.** Swap data sources behind one interface:
  - `mock` — deterministic synthetic market (default; works fully offline).
  - `yahoo` — live Yahoo Finance data (no API key).
- **Live ticker tape** and second-by-second market clock.
- **Typed end-to-end** with a shared data contract package.

---

## Quickstart

### Option A — Docker (one command, recommended)

Self-host the whole stack with [Docker](https://docs.docker.com/get-docker/):

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
exchange — the cornerstone of Midas's [crypto-native direction](./VISION.md):

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
| `TAS`   | `PRINTS`, `TS` | yes          | Live streaming trade prints (time & sales).    |
| `CVD`   | `FLOW`, `OFD`  | yes          | Order-flow / cumulative volume delta — buy vs sell pressure over time + per-window delta bars. |
| `IMB`   | `IMBALANCE`, `OBI` | yes      | Order-book imbalance — top-N bid vs ask depth pressure over time with a live gauge. |
| `LQA`   | `LIQUIDITY`, `SPREADS` | no   | Liquidity board — watchlist ranked by bid/ask spread (bps) and top-of-book depth. |
| `ALLQ`  | `XQ`, `VENUES` | yes          | Compare a pair across exchanges (best bid/ask).|
| `FUND`  | `OI`, `LIQ`    | yes          | Funding rate, open interest, liquidations.     |
| `FUNDR` | `RATES`, `CARRY` | no         | Funding + open interest across the top perps, sortable.|
| `LIQS`  | `LIQUIDATIONS`, `REKT` | no   | Market-wide liquidations feed across the top perps.|
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
| `SCAN`  | `SCANNER`, `SIGNALS`, `SETUP` | no | Signal scanner — watchlist SMA20/50 trend, RSI(14) overbought/oversold & 52-week range position, ranked by a bull/bear score. |
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
| `ALERT` | `ALRT`, `AL`   | optional     | Price / funding / 24h%-change alerts (above · below · cross), **local or server-backed** → toast / desktop. |
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
The `ALERT` panel's **Server** mode manages these rules.

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
| `PORT`                | `4000`      | API port.                           |
| `HOST`                | `0.0.0.0`   | API bind host.                      |
| `MIDAS_CORS_ORIGIN`   | `*`         | Allowed CORS origin.                |
| `LOG_LEVEL`           | `info`      | Pino log level.                     |
| `ANTHROPIC_API_KEY`   | —           | Enables the AI copilot (`AI`).       |
| `MIDAS_AI_MODEL`      | `claude-sonnet-4-6` | Claude model for the copilot.|
| `MIDAS_DATA_DIR`      | `./data`    | Where server state (alerts, users, workspaces, portfolios, watchlists, notes) is stored.|
| `MIDAS_ALERT_INTERVAL_MS` | `15000` | Background alert evaluation cadence.  |
| `MIDAS_ALERT_WEBHOOK` | —           | POST fired alerts here (Discord/Slack/custom).|
| `MIDAS_AUTH_ENABLED`  | `false`     | Require login (bearer token) for the API.|
| `MIDAS_AUTH_ALLOW_SIGNUP` | `true`  | Allow new accounts (first user always can).|
| `MIDAS_AUTH_SECRET`   | —           | Secret for signing session tokens.   |

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

The foundation is intentionally small and extensible. Likely next steps:

- **Data:** more providers (Finnhub, Polygon, Alpha Vantage), real-time
  streaming via WebSocket, richer fundamentals (market cap, P/E, financials),
  server-side caching.
- **Modules:** options chain, depth/level-2, economic calendar, equity
  screener, portfolio/positions, comparison overlays, technical studies.
- **Workspaces:** multiple named layouts, panel linking (a symbol typed in one
  panel updates linked panels), command-driven panel targeting.
- **Charts:** multi-symbol compare overlays, persisted studies & drawings.
- **Platform:** multi-user auth for self-hosting, broader test coverage (UI /
  component tests). _(Docker Compose deploy + a Vitest suite wired into
  typecheck/build/test CI already shipped.)_

---

## License

MIT — see [LICENSE](./LICENSE).
