# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's private vulnerability reporting:

> Repository → **Security** tab → **Report a vulnerability**

We'll acknowledge the report, investigate, and coordinate a fix and disclosure
timeline with you. Thank you for helping keep Midas and its users safe.

## Security posture

Midas is designed to be **self-hosted** and **non-custodial** by default:

- **Your funds never touch Midas.** The terminal reads market data and (when you
  configure a provider) reads from your exchange — it does not custody assets.
- **Execution is held.** Account access is read-only (balances, orders,
  positions, and fills). Order placement and in-app cancellation return
  `503 TradingSafetyHold` regardless of environment flags or key metadata.
  Midas never moves, withdraws, or custodies funds.
- **Bring-your-own data source.** With the default `mock` provider, nothing
  leaves your machine. Live providers (`ccxt`, `yahoo`) talk to public market
  endpoints; any exchange credentials you supply stay in your own deployment's
  environment.
- **Optional auth, hardened by default.** Authentication is off by default for
  a personal local instance and can be enabled for shared/hosted deployments.
  When it is on, repeated failed logins lock the username+IP pair out briefly
  (in-memory throttle) and lockouts are logged; API responses always carry
  baseline security headers (`X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`).

- **Per-user keys are encrypted at rest.** With `MIDAS_KEYS_KMS_SECRET` set,
  signed-in users may store their own exchange keys: AES-256-GCM at rest,
  write-only API (metadata comes back, secrets never), one-action delete,
  and strict isolation — a user-keyed client never inherits the operator's
  env keys, secondary venue or stream.
- **Per-user account reads are isolated.** A user with stored keys reads only
  through their own client and never inherits the operator's secondary venue
  or stream. Per-user background loops (fill watcher and equity snapshots)
  only poll that user's client, bounded by `MIDAS_MAX_KEYED_USERS`.

**For a step-by-step pre-exposure checklist, the full environment-variable
security matrix, and the execution safety boundary, see
[docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md).**

The codebase enforces these as invariants (each has a CI test): the execution
routes fail closed before provider access; stored exchange keys are allowlisted
to real ccxt ids; auth is timing-safe and cannot be used to enumerate usernames;
and secrets are AES-256-GCM at rest and never returned by the key API.

If you operate a shared or internet-exposed instance, enable authentication, put
it behind TLS, and treat any configured provider credentials as secrets. The
recommended checklist:

1. `MIDAS_AUTH_ENABLED=true` and a fixed `MIDAS_AUTH_SECRET` (e.g.
   `openssl rand -hex 32` — `scripts/deploy.sh` generates one for you).
2. Pin `MIDAS_CORS_ORIGIN` to your terminal's exact origin.
3. TLS in front (Caddy/nginx/Traefik); never expose the raw HTTP port.
4. Use read-only exchange keys. Withdrawal permission is never appropriate:
   Midas has no withdrawal code path, and the blast radius if a key leaks is total.

## Execution safety hold

Live order placement is currently **NO-GO**. `POST /api/orders` and
`DELETE /api/orders/:id` fail with `503 TradingSafetyHold` before resolving a
provider mutation. `GET /api/trading/status` reports the same hold reason to the
terminal, which keeps `TICKET` in preview-only mode and `ORD` read-only.

No value of `MIDAS_TRADING_ENABLED`, `MIDAS_TRADING_ALLOW_NO_AUTH`, the notional
cap variables, operator credentials, stored user credentials, or `canTrade`
metadata bypasses the hold. Manage existing resting orders at the exchange.

The re-enable criteria are documented in
[docs/EXECUTION_SAFETY_HOLD.md](docs/EXECUTION_SAFETY_HOLD.md). Until every item
passes a security review and exchange-sandbox certification, the hold is the
execution authority.

## Data honesty is a safety property

Midas treats mislabeling data as a defect: synthetic/delayed/unavailable data is
never presented as live. If you find a place where provenance is wrong or
missing, that's a bug worth reporting (a normal issue is fine for that).

## Supported versions

Midas is pre-1.0 and ships from `main`; fixes land there. Pin a commit for
reproducible deployments.
