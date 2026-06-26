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
