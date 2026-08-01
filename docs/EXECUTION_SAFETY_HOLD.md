# Execution safety hold

## Current posture

Midas is a non-custodial crypto research terminal. Market data, charts, account
reads, alerts, paper portfolios, and order previews remain available.

The HTTP execution boundary is **cancel-only**:

- `POST /api/orders` returns `503 TradingSafetyHold` — fail-closed, forever
  pinned. No environment flag, operator key, stored user key, or `canTrade`
  value can make it call a provider placement.
- `DELETE /api/orders/:id` is **live** for the authenticated owner of that
  order (see the carve-out below).
- `GET /api/trading/status` reports `{ enabled: false, cancelEnabled: true,
  mode: 'cancel-only', reason }` with the hold reason.

New orders must be placed directly at the exchange; resting orders can be
pulled from the ORD panel (two-step confirm) or the API.

## Why the placement hold exists

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

## Cancellation carve-out

Cancellation is live because it is **risk-reducing**, and every reason the
placement path is held does not apply to it:

- It moves no funds — it can only remove resting exposure, so there is no
  notional to estimate, cap, or normalize to USD (gate items 4–5).
- It needs no idempotency-of-money: a duplicated cancel is a no-op at the
  exchange, not a duplicated position (gate items 1–2).
- Forcing a trader to context-switch to the exchange UI to pull a resting
  order in a fast market is itself a safety hazard.

The controls that cancellation DOES require are implemented and tested:

- **Authenticated ownership with no operator-account fallback.** The route
  resolves the caller exactly like the account reads do (`pool.accountFor`):
  the operator session's own provider on a single-operator deployment, or the
  caller's own per-user key on a keyed deployment. A user without usable keys
  gets an honest 503 — never the operator's account.
- **Ownership verified before submission.** The order id must appear in THAT
  caller's open-orders list before any cancel call is made; an id that isn't
  there gets a 404, never a blind cancel against the exchange.
- **Honest outcomes.** Exchange confirmation → `200 CancelResult`; already
  filled/canceled → `409`; timeout or network failure → `502` with an explicit
  "outcome unknown — check the exchange" message. An unknown outcome is never
  reported as a successful cancel, and raw exchange errors are sanitized
  (signed request URLs never reach the client).
- **Failure-injection tests.** Route-level proofs for cross-user cancel (404),
  order-not-in-list (404), no-keys (503, no fallback), 409/502 propagation,
  and the mock/ccxt provider outcomes; the placement 503 proofs stay pinned in
  `safetyHold.test.ts` and `depWave.regression.test.ts`.

One honest limitation: on an operator deployment with a secondary read venue
(`MIDAS_CCXT_EXCHANGE_2`), cancels target the primary venue only — an order
resting on the secondary venue answers the same 409 "no longer open" message,
which names that possibility.

## Re-enable gate (placement)

Order placement remains NO-GO until one reviewed change provides all of the
following:

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

Until every item passes, this hold is the execution authority for placement.
The legacy pure gate helpers in `apps/server/src/trading.ts` are repair
scaffolding only.
