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

> Running on Claude Code on the web? The sandbox network policy may block
> external finance hosts. Either run locally, or allowlist
> `query1.finance.yahoo.com` / `query2.finance.yahoo.com` in your
> [environment's network policy](https://code.claude.com/docs/en/claude-code-on-the-web).

---

## Command reference

| Command | Aliases        | Needs symbol | Description                                   |
| ------- | -------------- | ------------ | --------------------------------------------- |
| `DES`   | `DESC`, `DS`   | yes          | Snapshot quote + key stats for a security.    |
| `GP`    | `CHART`, `G`   | yes          | Historical price chart (daily candles).       |
| `GIP`   | `INTRADAY`     | yes          | Intraday price chart (5-minute candles).       |
| `BOOK`  | `DOM`, `OB`    | yes          | Live Level-2 order book / depth of market.     |
| `ALLQ`  | `XQ`, `VENUES` | yes          | Compare a pair across exchanges (best bid/ask).|
| `FUND`  | `OI`, `LIQ`    | yes          | Funding rate, open interest, liquidations.     |
| `SCR`   | `EQS`, `MOVERS`| no           | Screen crypto by volume / 24h change / price.  |
| `AI`    | `ASK`          | no           | Claude copilot grounded in your live data.     |
| `W`     | `WATCH`, `WL`  | no           | Your personal watchlist.                      |
| `Q`     | `QM`, `QUOTE`  | no           | Dense live quote grid for watchlist symbols.  |
| `N`     | `NEWS`, `CN`   | optional     | Headlines for a symbol (or market if omitted).|
| `TOP`   | `MKT`          | no           | Top market-wide news.                         |
| `SECF`  | `FIND`, `SRCH` | no           | Search for securities by ticker or name.      |
| `HELP`  | `H`, `?`       | no           | Command list and usage.                       |

**Grammar:** `BTC/USDT` → description · `BTC/USDT GP` → chart · `BTC/USDT BOOK` → order book ·
bare `W`/`HELP` → symbol-less panels · unrecognized text → security search.

**Keyboard:** start typing anywhere to focus the command line · `↑/↓` recall
history or move through suggestions · `Tab` complete · `Esc` clear.

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
| `GET /api/search?q=`               | `SearchResult[]`                 |
| `GET /api/news?symbol=`            | `NewsItem[]`                     |

`/api/history` accepts `interval` (`1m`…`1mo`) and `range` (`1d`…`max`).

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
- **Charts:** drawing tools, indicators (MA/RSI/MACD), multiple series.
- **Platform:** auth for multi-user self-hosting, Docker compose, tests + CI.

---

## License

MIT — see [LICENSE](./LICENSE).
