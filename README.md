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
| `MOV`   | `OVERVIEW`, `BREADTH` | no    | Market overview — top gainers, losers, most active + breadth.|
| `CORR`  | `COR`, `CORREL`| no           | Return-correlation matrix across your watchlist.|
| `BETA`  | `BTCBETA`, `BETAS` | no       | Beta board — each watchlist symbol’s beta, correlation & R² vs BTC from daily returns. |
| `RBETA` | `ROLLBETA`, `RCORR` | yes     | Rolling beta & correlation vs BTC — how a symbol’s sensitivity to Bitcoin drifts over a trailing window. |
| `SCAT`  | `SCATTER`, `REGRESS` | yes    | Returns scatter vs BTC — daily returns with the fitted regression line (beta, alpha, R²). |
| `SHARPE`| `SORTINO`, `RISKADJ` | no    | Risk-adjusted return board — Sharpe & Sortino (annualized) with annualized return & vol across your watchlist. |
| `DD`    | `DRAWDOWN`, `UNDERWATER`, `MDD` | no | Drawdown monitor — max & current drawdown, time underwater and an underwater curve across your watchlist. |
| `CAL`   | `CALENDAR`, `EVENTS`, `ECON` | no | Market calendar — funding settlements, options/futures expiries and candle closes, with countdowns. |
| `VOL`   | `VOLATILITY`, `ATR`, `RV` | no | Volatility dashboard — realized vol, ATR% and high-low range ranked across your watchlist. |
| `VAR`   | `DIST`, `HIST`, `CVAR` | yes  | Return distribution & risk — histogram with vol, skew, kurtosis and historical VaR / expected shortfall. |
| `VTS`   | `VOLTERM`, `TERM` | yes       | Volatility term structure — realized vol across 7d…180d lookbacks, flagging rich/cheap near-term vol. |
| `MC`    | `MONTECARLO`, `CONE` | yes    | Monte Carlo projection cone — GBM price forecast fan (5–95 percentiles) from historical drift & vol. |
| `MOM`   | `MOMENTUM`, `RS`, `STRENGTH` | no | Momentum / relative-strength board — 24h/7d/30d returns ranked across your watchlist. |
| `RRG`   | `ROTATION`, `ROT` | no       | Relative rotation graph — watchlist symbols by RS-Ratio × RS-Momentum vs BTC, with rotation tails. |
| `SEAS`  | `SEASON`, `SEASONALITY`, `TOD` | yes | Returns seasonality — average return by UTC hour-of-day and day-of-week as a heat grid. |
| `MRET`  | `MONTHLY`, `CALRET` | yes     | Monthly returns heatmap — month-over-month % as a year × month grid with compounded year totals. |
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
| `ALERT` | `ALRT`, `AL`   | optional     | Price / funding / 24h%-change alerts (above · below · cross), **local or server-backed** → toast / desktop. |
| `ACCT`  | `ACCOUNT`      | no           | Manage your account — password, sessions, and (admin) users.|
| `PREF`  | `SETTINGS`, `SET`, `CONFIG` | no | Terminal preferences — density, ticker, default chart timeframe, alert sound/desktop. Saved to your browser. |
| `REPORT`| `EXPORT`, `CSV` | no         | Export your data to CSV — trade journal, transactions, positions, alert triggers and watchlists. |
| `NOTE`  | `NOTES`, `JRNL`, `MEMO` | no  | Free-form notes — global or per symbol, synced to your account.|
| `RISK`  | `SIZER`, `SIZE` | no          | Risk-based position sizer — size from account, risk %, entry & stop, with R-targets & liq. estimate. |
| `CONV`  | `NOTIONAL`, `CONVERT` | yes    | Size / notional converter — convert between quantity, notional, % of account and margin at the live price. |
| `KELLY` | `BETSIZE`, `OPTIMALF`, `KCRIT` | no | Kelly-criterion bet sizing — optimal bankroll fraction from win rate & payoff, with half/quarter Kelly, expectancy & breakeven win. |
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
