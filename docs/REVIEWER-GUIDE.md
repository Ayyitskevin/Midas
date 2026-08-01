# Midas reviewer guide

This is a short, disposable path for a software peer to evaluate Midas without
an exchange account, an Anthropic key, private state, or a hosted environment.

## 1. Run the safe demo

```bash
pnpm install --frozen-lockfile
pnpm reviewer:demo
```

Open <http://127.0.0.1:4173/Midas/demo/>. The launcher builds the static web
terminal, serves it from loopback, and uses only deterministic in-browser
synthetic data. It strips `MIDAS_*` and credential-bearing environment values;
it never starts the Fastify server, loads `.env`, contacts an exchange, calls
Anthropic, sends a webhook, or writes account state. Stop it with `Ctrl+C`.

Try the first-run tour, then type:

```text
BTC/USDT
BTC/USDT GP
ETH/USDT BOOK
FUND
SYS
TICKET
```

The amber/demo labels and the `TICKET` safety hold are part of the product
contract, not fake live trading.

## 2. Orient in the code

Read [`ARCHITECTURE.md`](ARCHITECTURE.md), then inspect:

- `packages/shared/src/` — the typed data contract shared by server, web, and
  the static demo;
- `apps/server/src/providers/` — mock, Yahoo, and CCXT provider seams;
- `apps/server/src/routes/` — HTTP boundaries and caller/account isolation;
- `apps/server/src/trading.ts` and `docs/EXECUTION_SAFETY_HOLD.md` — the
  unconditional no-execution boundary;
- `apps/web/src/commands/` and `apps/web/src/modules/` — command grammar and
  panel registration;
- `apps/web/src/demo/` — the offline data engine and API shim;
- `apps/server/src/alerts/`, `apps/server/src/keys/`, and the persistence
  repositories — the concurrency, credential, and lifecycle seams.

## 3. Reproduce the gates

```bash
pnpm -r typecheck
pnpm test
pnpm build
node scripts/check-bundle.mjs
pnpm --filter @midas/web build:demo
pnpm test:reviewer
```

The full CI workflow is the source of truth. A green suite proves the checked
contracts; it does not certify live exchange behavior, a hosted deployment, or
trading safety beyond the paths covered by the tests.

## 4. Review seams worth challenging

| Interest | Suggested seam | Question |
| --- | --- | --- |
| Data honesty | provider interfaces, `sourceStatus`, demo shim | Can synthetic, stale, or unavailable data be mistaken for live data? |
| Non-custody | CCXT provider, account routes, keys store | Can a caller read another user's account or cause a credential to leave its boundary? |
| Execution safety | `trading.ts`, order routes, `TICKET` | Is every mutation path still unreachable and visibly held? |
| Multi-user state | auth, workspaces, alerts, equity, account loops | Do concurrent writes preserve the current user's state and lifecycle cleanup? |
| Resource limits | WebSocket stream, provider fan-out, rate limits | Can one unauthenticated client exhaust memory, upstream calls, or a shared quota? |
| Product surface | command registry, module registry, shared contracts | Does a new board have one typed source of truth across server, web, and demo? |
| Optional AI | `apps/server/src/ai.ts`, `routes/ai.ts` | Is outbound spend bounded, the prompt data-minimized, and the feature dormant without a key? |

## Current boundaries

- Midas is pre-1.0 and free/open-source. Optional shared hosting is a
  self-host deployment mode, not a paid service.
- The public/static demo is synthetic and browser-only. It is not evidence of
  live market quality or exchange connectivity.
- Account features are read-only and require operator- or user-supplied
  credentials. Never use real credentials in a review environment.
- Live order placement and in-app cancellation are `NO-GO` until every criterion
  in [`EXECUTION_SAFETY_HOLD.md`](EXECUTION_SAFETY_HOLD.md) is independently
  reviewed and certified.
- Review changes against `main`. The repository's GitHub default branch has
  previously pointed at an active work branch; that setting is not a substitute
  for the `main` review gate.

## Review hygiene

- Use disposable local state only.
- Report vulnerabilities privately through
  [`SECURITY.md`](https://github.com/Ayyitskevin/Midas/blob/main/SECURITY.md).
- Separate correctness, safety, product-scope, and style feedback.
- Include a reproducible command or invariant with each material finding.
