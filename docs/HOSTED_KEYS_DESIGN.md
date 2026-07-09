# Design: per-user exchange keys (historical)

> The account-read isolation and encrypted key-storage portions remain current.
> All execution sections are historical and are superseded by the fail-closed
> [execution safety hold](EXECUTION_SAFETY_HOLD.md).

Status: **implemented** — PRs 1–3 shipped (deviations noted inline). This
is the one architectural change a multi-tenant hosted Midas needs. Written
first so the implementation PRs could be judged against an agreed shape.

## Problem

Today exchange keys live in the **process environment** (`MIDAS_CCXT_API_KEY`
etc.) and every authenticated user of an instance shares them. That is the
right model for self-hosting (one operator, one account, keys never in the
DB) and the wrong model for a hosted tier (many users, each with their own
exchange account, on shared infrastructure).

## Goals

1. Each user supplies their own read-only (or trade) keys, scoped to their
   login; no user can ever read another's keys or data.
2. Keys are encrypted at rest, never returned by any API after write, never
   logged, and deletable in one action.
3. The self-hosted env-key model keeps working unchanged — per-user keys are
   an additive layer, not a migration.
4. The non-custodial invariants survive verbatim: reads by default, exactly
   two write methods, every trading gate re-checked per user.

## Non-goals

- Withdrawal/transfer permissions (never), key sharing between users,
  custody of anything.

## Design

### Storage

- New `KeyRepo` (file-backed JSON like every other repo; a hosted deployment
  swaps the file for its DB adapter later): `{ userId → { exchange, apiKey,
  secret, password?, canTrade, createdAt } }`.
- Encrypted at rest with a key derived from `MIDAS_KEYS_KMS_SECRET`
  (AES-256-GCM via node:crypto; per-record random IV). The KMS secret lives
  only in the operator's env — same trust root as `MIDAS_AUTH_SECRET`.
- API: `PUT /api/account/keys` (write-only; responds `{ok, exchange,
  keyLast4}`), `GET /api/account/keys` (metadata only — exchange + last4 +
  canTrade, never the secret), `DELETE /api/account/keys`.

### Provider resolution

- Today: one `CcxtProvider` per process. After: a `ProviderPool` keyed by
  userId — `poolFor(userId)` returns (and caches, LRU ~50 with idle
  eviction) a per-user authenticated exchange client; the env-keyed client
  remains the `@local` default so self-host behavior is unchanged.
- Account routes (`/api/balances`, orders, positions, fills, equity,
  events) resolve their provider through the pool using `req.userId`.
- Background loops (watcher, equity) become per-user loop sets, started on
  key write (and at boot for existing keyed users), stopped on key delete —
  bounded by a `MIDAS_MAX_KEYED_USERS` cap so a hosted box degrades
  predictably. *(As built: the **digest stays operator-only** — a per-user
  digest is meaningless without per-user webhooks, which are a future user
  setting. User fill events surface in the user's in-terminal feed only.
  A keyed user whose loops aren't running gets an honest "not running"
  answer from the events/equity routes — never the operator's feed.)*

### Trading

- `computeTradingStatus` gains a per-user context `{ canTrade, usable }`
  (from the stored key's `canTrade` flag and whether the key decrypts).
  All existing gates and caps remain; the daily ledger and clientOrderId
  idempotency cache are scoped per trading identity ('@local' for the
  operator, the userId for keyed users).
- **The account rule** (the security core, enforced in `resolveTrading` +
  `ProviderPool.userFor`): whichever account a user's reads resolve to is
  the only account their writes may touch. A user WITH stored keys trades
  through their own client or not at all — undecryptable keys hard-disable
  trading for them rather than silently falling back to the operator's
  account. Users WITHOUT stored keys keep the self-host behavior verbatim.
- Cap-check reference quotes come from the same client that will trade, so
  notional caps are priced on the venue the order lands on. Audit logs and
  the operator webhook tag user-keyed writes with the userId (never key
  material) — the operator hosts the box and sees what it does.

### Rollout

1. ✅ PR 1: KeyRepo + crypto + routes + tests (no behavior change without keys).
2. ✅ PR 2: ProviderPool + account-read resolution. *(Shipped without
   per-user background loops — the watcher/equity/digest stay on the
   operator's env keys for now; per-user loops move to PR 3 with trading,
   where their lifecycle and caps get one review together.)*
3. ✅ PR 3: per-user watcher/equity loops and the historical execution
   prototype. The loops remain; the execution portion is retired behind the
   safety hold. The `KEYS` panel now exposes the encrypted key store.

### Open questions

- Idle-loop eviction policy for very large user counts (hosted-only; today
  the cap refuses loops past `MIDAS_MAX_KEYED_USERS`, reads stay per-request).
- Whether to remove legacy `canTrade` metadata entirely while execution remains
  held (product and compatibility decision, not architecture).
