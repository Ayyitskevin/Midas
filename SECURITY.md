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
- **Read-only by default; trading is strictly opt-in.** Account access starts
  read-only (balances/orders/positions), and live order placement is **off**
  unless you deliberately enable it (see below). Midas never moves or withdraws
  funds — the only write it can perform is placing an order you explicitly confirm.
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

If you operate a shared or internet-exposed instance, enable authentication, put
it behind TLS, and treat any configured provider credentials as secrets. The
recommended checklist:

1. `MIDAS_AUTH_ENABLED=true` and a fixed `MIDAS_AUTH_SECRET` (e.g.
   `openssl rand -hex 32` — `scripts/deploy.sh` generates one for you).
2. Pin `MIDAS_CORS_ORIGIN` to your terminal's exact origin — required for the
   no-auth trading override, sensible everywhere else.
3. TLS in front (Caddy/nginx/Traefik); never expose the raw HTTP port.
4. Read-only exchange keys unless you have deliberately enabled trading; keys
   with withdrawal permission are never appropriate — Midas has no withdrawal
   code path to use them, and their blast radius if leaked is total.
5. Keep `MIDAS_MAX_ORDER_USD` / `MIDAS_MAX_DAILY_USD` at values you can afford
   to lose to a bug — yours or an exchange's.

## Live trading (opt-in)

Live order placement is gated by defense in depth and **off by default**. It
activates only when all of these hold: `MIDAS_TRADING_ENABLED=true`, the `ccxt`
provider with **trade-permissioned** API keys, and auth enabled (or an explicit
`MIDAS_TRADING_ALLOW_NO_AUTH=true` override). Every order is validated and capped
at `MIDAS_MAX_ORDER_USD` server-side before the single `createOrder` call.

Recommendations if you enable trading:

- Use API keys scoped to **trade only** — never enable withdrawal permission, and
  IP-allowlist the keys at the exchange.
- Keep `MIDAS_MAX_ORDER_USD` as low as your use allows; it is your blast-radius cap.
- Require auth (`MIDAS_AUTH_ENABLED=true`) and TLS for any non-localhost instance;
  do not use the no-auth override on a network-reachable host. The server **refuses
  to enable no-auth trading while `MIDAS_CORS_ORIGIN=*`** (the default), since that
  combination is a cross-site request-forgery vector — pin `MIDAS_CORS_ORIGIN` to
  your terminal's exact origin, or just enable auth (bearer tokens are not sent
  cross-site).
- The master switch is your kill switch: set `MIDAS_TRADING_ENABLED=false` and
  restart to disable placement instantly.

## Data honesty is a safety property

Midas treats mislabeling data as a defect: synthetic/delayed/unavailable data is
never presented as live. If you find a place where provenance is wrong or
missing, that's a bug worth reporting (a normal issue is fine for that).

## Supported versions

Midas is pre-1.0 and ships from `main`; fixes land there. Pin a commit for
reproducible deployments.
