# Execution safety hold

## Current posture

Midas is a read-only crypto research terminal. Market data, charts, account
reads, alerts, paper portfolios, and order previews remain available.

The HTTP execution boundary is fail-closed:

- `POST /api/orders` returns `503 TradingSafetyHold`.
- `DELETE /api/orders/:id` returns `503 TradingSafetyHold`.
- `GET /api/trading/status` reports preview-only with the hold reason.
- No environment flag, operator key, stored user key, or `canTrade` value can
  make those routes call a provider mutation.

Manage any existing resting orders directly at the exchange.

## Why the hold exists

The retired route implementation did not meet the minimum controls for software
that can move real funds:

1. Daily exposure and idempotency state lived only in process memory, so restart
   or multiple replicas could reset or multiply the controls.
2. Concurrent retries could pass the idempotency check before either request
   recorded its result.
3. An exchange could accept an order while the client timed out, leaving an
   unknown outcome that a retry might duplicate.
4. Notional estimation multiplied base amount by pair price without normalizing
   arbitrary quote assets or derivative contract sizes to USD.
5. Market-order estimates did not provide a hard maximum execution price.

## Re-enable gate

Execution remains NO-GO until one reviewed change provides all of the following:

- A durable transactional execution journal shared by every server instance.
- Atomic reservation of idempotency keys and daily exposure before submission.
- Explicit `pending`, `accepted`, `rejected`, and `unknown` outcomes.
- Startup reconciliation against the exchange before new submissions are allowed.
- Instrument metadata and quote conversion that produce a verified USD notional.
- Market-order protection that bounds the maximum executable notional.
- Authenticated ownership rules with no operator-account fallback for normal users.
- Failure-injection tests for restart, concurrency, timeout-after-acceptance, and
  multi-instance operation.
- A human-reviewed operational runbook and exchange sandbox certification.

Until every item passes, this hold is the execution authority. The legacy pure
gate helpers in `apps/server/src/trading.ts` are repair scaffolding only.
