# Design: per-user exchange keys (hosted-tier groundwork)

Status: **design only** — nothing here is implemented. This is the one
architectural change a multi-tenant hosted Midas needs, and the last
engineering item from the v1 roadmap. Written first so the implementation
PR can be judged against an agreed shape.

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
- Background loops (watcher, equity, digest) become per-user loop sets,
  started lazily on first key write and stopped on key delete — bounded by
  a `MIDAS_MAX_KEYED_USERS` cap so a hosted box degrades predictably.

### Trading

- `computeTradingStatus` gains `ctx.userCanTrade` (from the stored key's
  `canTrade` flag, set only when the user explicitly marked the key as
  trade-permissioned). All existing gates and caps remain; per-order and
  daily ledgers become per-user.

### Rollout

1. PR 1: KeyRepo + crypto + routes + tests (no behavior change without keys).
2. PR 2: ProviderPool + account-read resolution + per-user watcher/equity.
3. PR 3: per-user trading gates + ledgers; security review before merge.

### Open questions

- Idle-loop eviction policy for very large user counts (hosted-only).
- Whether the hosted tier should force `canTrade=false` at $20 and reserve
  trading for the $49 desk tier (product decision, not architecture).
