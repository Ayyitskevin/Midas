# Shared hosting — operator entry

**Single entry point** for running a multi-user Midas instance. This page does
not invent product features; it points at the authoritative runbooks and lists
the **env flags that must exist in server config** for the multi-user posture.

| Goal | Doc |
|---|---|
| Provision box + invite email | [`HOSTED_BETA.md`](./HOSTED_BETA.md) |
| Pre-invite smoke gate + go/no-go | [`HOSTED_GO_LIVE.md`](./HOSTED_GO_LIVE.md) |
| Security matrix + pre-exposure | [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) |
| Per-user key design | [`HOSTED_KEYS_DESIGN.md`](./HOSTED_KEYS_DESIGN.md) |
| Execution hold (cannot bypass) | [`EXECUTION_SAFETY_HOLD.md`](./EXECUTION_SAFETY_HOLD.md) |

**Billing:** none. Midas is free and open source; there is no paid tier and no
Stripe path in this runbook.

---

## Fail-closed behaviors (must stay true)

| Behavior | Operator expectation | Code authority |
|---|---|---|
| Order placement | `POST /api/orders` → **503** `TradingSafetyHold` | `apps/server/src/routes/account.ts` + `executionSafetyHoldStatus` |
| Order cancel in-app | `DELETE /api/orders/:id` → **503** | same |
| Trading status | `enabled: false` always under hold | `apps/server/src/trading.ts` |
| Legacy trade flags | `MIDAS_TRADING_*` / max USD flags **do not** lift the hold | `docs/EXECUTION_SAFETY_HOLD.md`, SECURITY_HARDENING |
| Per-user keys without auth | Keys store refuses to start unless auth is on | config + keys module |
| Missing user key | Account reads → **unavailable**, never operator fallback when KMS store is on | HOSTED_KEYS_DESIGN |

Before invitees: run  
`node scripts/smoke-hosted.mjs https://your-host --user … --pass …`  
and require **All green** ([HOSTED_GO_LIVE §3](./HOSTED_GO_LIVE.md)).

---

## Canonical multi-user env checklist

Flags below are the **minimum shared-hosting posture**. Defaults in the table
match `apps/server/src/config.ts` (solo/offline-friendly). Hosted boxes **must
override** the “hosted value” column.

<!-- shared-hosting-flags:begin -->
| Flag | Default (code) | Hosted value | Role |
|---|---|---|---|
| `MIDAS_DATA_PROVIDER` | `mock` | `ccxt` | Live markets vs synthetic offline |
| `MIDAS_AUTH_ENABLED` | `false` | `true` | Require login for the API |
| `MIDAS_AUTH_SECRET` | empty / random boot | fixed `openssl rand -hex 32` | Session HMAC; set fixed ≥16 chars |
| `MIDAS_AUTH_ALLOW_SIGNUP` | `false` | `true` only while onboarding | Open registration; close after invites |
| `MIDAS_CORS_ORIGIN` | `*` | exact site origin | Pin browser origin; never `*` on public multi-user |
| `MIDAS_KEYS_KMS_SECRET` | empty | `openssl rand -hex 32` | AES per-user keys; backup or keys unrecoverable |
| `MIDAS_MAX_KEYED_USERS` | `25` | `25` (or lower) | Cap per-user background loops |
| `MIDAS_RATE_LIMIT_RPM` | `0` (off) | e.g. `240` | Per-IP ceiling on public surfaces |
| `MIDAS_TRUST_PROXY` | `0` | `1` behind one reverse proxy | Real client IP for rate limits |
| `MIDAS_ACCOUNT_WATCH_MS` | `10000` | as needed | Fill-watch loop for keyed users |
| `MIDAS_EQUITY_SNAP_MS` | `3600000` | as needed | Equity snapshots for keyed users |
| `MIDAS_DIGEST_HOURS` | `0` (off) | `24` if morning recap | Needs `MIDAS_ALERT_WEBHOOK` |
| `MIDAS_ALERT_WEBHOOK` | empty | Discord/webhook URL optional | Digest + alert delivery |
| `MIDAS_TRADING_ENABLED` | `false` | `false` (legacy) | **Does not** enable execution under hold |
| `MIDAS_MAX_ORDER_USD` | `1000` | legacy only | Not an active execution control under hold |
| `MIDAS_MAX_DAILY_USD` | `5000` | legacy only | Not an active execution control under hold |
<!-- shared-hosting-flags:end -->

Full matrix and TLS notes: [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md).  
Deploy smoke + invite flow: [`HOSTED_GO_LIVE.md`](./HOSTED_GO_LIVE.md) +
[`HOSTED_BETA.md`](./HOSTED_BETA.md).

---

## Operator path (short)

1. `./scripts/deploy.sh` then set hosted flags above; TLS in front.
2. First signup = admin; run smoke-hosted until All green.
3. Invite users (`HOSTED_BETA` email); each runs `KEYS` with **read-only** exchange keys.
4. `MIDAS_AUTH_ALLOW_SIGNUP=false` after the group is in.
5. Confirm `TICKET` / trading status remain **preview-only** under the safety hold.

**Do not ship live order placement** on a shared box until the re-enable gate in
[`EXECUTION_SAFETY_HOLD.md`](./EXECUTION_SAFETY_HOLD.md) is fully met and
maintainer-approved.
