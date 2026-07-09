# Architecture

A map of how Midas fits together, for contributors. For setup and the gates see
[CONTRIBUTING](https://github.com/Ayyitskevin/Midas/blob/main/CONTRIBUTING.md).

## The big picture

Midas is a pnpm monorepo with three packages and one rule between them: the
**shared package is the only contract** the web and server agree on.

```
packages/shared   @midas/shared — TypeScript types (the data contract). No runtime deps.
        │  (types only)
        ▼
apps/server       Fastify API. A pluggable DataProvider turns a request into typed data.
        │  HTTP /api/* (+ WebSocket /api/stream)
        ▼
apps/web          React/Vite terminal. A command bar opens tiling panels (modules)
                  that fetch from the API and render.
```

Data flows one way for reads: **web → `api` client → server route → `DataProvider`
method → typed response (shaped by `@midas/shared`) → web renders.** Live feeds
(trades, order book, ticker) arrive over a WebSocket at `/api/stream`.

## `packages/shared` — the contract

`packages/shared/src/index.ts` (plus `alerts.ts`, `auth.ts`) holds the types both
apps import: `Quote`, `Candle`, `OrderBook`, `DerivativesInfo`, `ScreenerRow`,
`DexPools`, `Alert`, and so on. In dev it resolves to source, so a type change is
visible to both apps immediately. **If you add a field that crosses the wire, it
starts here.**

## `apps/server` — the API and the data seam

Fastify app (`src/app.ts`) mounts routes (`src/routes.ts`, plus `auth/`,
`alerts/`, `snapshots/` route modules). The important abstraction is the
**`DataProvider`** interface (`src/providers/types.ts`): every market-data
capability the UI needs is a method on it.

Three implementations, selected by `MIDAS_DATA_PROVIDER`:

| Provider | `live` | What it is |
| --- | --- | --- |
| `mock` (default) | `false` | Deterministic synthetic market — fully offline, reproducible (seeded RNG in `providers/util.ts`). |
| `ccxt` | `true` | Live multi-exchange crypto via [CCXT](https://github.com/ccxt/ccxt). |
| `yahoo` | `true` | Live equities via Yahoo's public endpoints. |

A route is thin: validate input, call one provider method, return its result.
Cross-symbol "boards" (e.g. `/api/funding`, `/api/liquidations`) are composed
server-side from `screen()` + per-symbol calls so every provider supports them.

Adding a new data capability end-to-end touches: the type in `@midas/shared` →
the method on `DataProvider` + all three providers → a route → the web `api`
client. The on-chain/DEX work (`providers/dexscreener.ts`, `getDexPools`) is a
compact worked example.

## `apps/web` — the terminal

### Command system

The command bar parses Bloomberg-style input (`src/commands/parser.ts`):
`SYMBOL FUNCTION` (`BTC/USDT GP`), a bare symbol, or a symbol-less command (`W`).
`src/commands/registry.ts` is the list of `CommandDef`s (code, aliases, the
module it opens, whether it needs a symbol). `src/commands/execute.ts` turns a
parsed command into an open panel (`openCommand` / `openModule` / `runCommand`).

### Panels and modules

`src/store/usePanels.ts` (Zustand, persisted) owns the workspace: a list of
panels on a 12-column grid, each with a `module`, `symbol`, and optional
`params`. A **module** is the React component that renders a panel
(`src/modules/<Name>Module.tsx`). Modules are registered in three places:

1. `src/modules/meta.ts` — the `ModuleCode` union **and** `PANEL` metadata
   (title, default size).
2. `src/modules/registry.tsx` — a lazy `import()` (code-split per module).
3. `src/commands/registry.ts` — the command that opens it.

A module receives `{ panel }` (`ModuleProps`) and reads `panel.symbol` /
`panel.params`. Pre-loaded state (e.g. a deep-linked scan) rides in
`panel.params` and is read on mount — see `ComparisonModule` / `ScanModule`.

### State and pure logic

- `src/store/*` — Zustand stores; several use `persist` (localStorage) and a few
  sync per-user to the server (workspaces, portfolio, watchlists, notes, alerts).
- `src/lib/*` — **pure, unit-tested** logic: indicator math, formatters, view
  helpers (`<name>.ts` + `<name>.test.ts`). Keep calculations here, not in
  components, so they're testable.
- `src/lib/api.ts` — the typed HTTP client; `src/lib/hooks.ts` — `useFetch`
  (polling + abort) used by data modules.

## Data honesty (the core principle)

Midas never presents synthetic, delayed, or unavailable data as if it were live:

- Providers expose a `live` flag; `/api/health` reports the active provider, and
  `lib/sourceStatus.ts` maps it to the status-bar badge and the demo banner.
- Where a source can't serve a feature it returns an honest **provenance** in the
  data itself (`LiquidationsProvenance`, `DexPools.provenance`:
  `live` / `synthetic` / `unavailable`) rather than guessing — the UI surfaces it.

When you add a surface that shows data, label its provenance.

## Execution safety boundary

Everything above is read-only market, account, research, or paper state. The two
legacy execution endpoints are registered as fail-closed compatibility routes:

```
POST /api/orders            DELETE /api/orders/:id
      │                            │
      ▼                            ▼
503 TradingSafetyHold      503 TradingSafetyHold
```

No request path from these endpoints resolves or invokes `provider.placeOrder`
or `provider.cancelOrder`. `GET /api/trading/status` returns the same hold reason
regardless of runtime flags or key metadata, and the UI remains in preview-only
mode. Read-only open-order lookup remains available. Existing orders must be
managed directly at the exchange.

The legacy pure gate helpers remain in `apps/server/src/trading.ts` only as repair
scaffolding. They are not execution authority. Re-enable criteria are documented
in [EXECUTION_SAFETY_HOLD.md](./EXECUTION_SAFETY_HOLD.md).

## Adding an indicator/analytics board

The most common contribution. The steps (with the architectural "why") are in
[CONTRIBUTING](https://github.com/Ayyitskevin/Midas/blob/main/CONTRIBUTING.md#adding-an-indicatoranalytics-board-the-common-case):
add a pure `lib/<name>.ts` (+ test), a `<Name>Module.tsx`, then register it in
`meta.ts`, `registry.tsx`, and `commands/registry.ts`, and add a README row.
Copy the nearest existing board and adapt it.

## Testing & gates

Unit tests live next to the code (`*.test.ts`, Vitest). Pure logic is tested;
side-effect components/engines (e.g. the alert loop) generally aren't. The four
gates — `pnpm -r typecheck`, server tests, web tests, `vite build` — run in CI on
every PR and should pass locally first.
