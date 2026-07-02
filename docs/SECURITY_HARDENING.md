# Security hardening playbook

Operator-facing companion to [SECURITY.md](https://github.com/Ayyitskevin/Midas/blob/main/SECURITY.md).
`SECURITY.md` states the posture and how to report a vulnerability; this page
is the concrete pre-exposure checklist and the environment-variable security
matrix for anyone putting Midas on a network other people can reach.

Midas is safe by default: an empty `.env` runs the offline mock feed with
trading impossible and no accounts. Everything below matters only as you turn
capabilities *on*.

## Pre-exposure checklist

Before a Midas box is reachable by anyone but you:

1. **TLS in front, always.** Terminate HTTPS at Caddy/nginx/Traefik; never
   expose the raw HTTP port. Bearer tokens and (if configured) exchange reads
   travel over it.
2. **Turn on auth.** `MIDAS_AUTH_ENABLED=true` and set a strong
   `MIDAS_AUTH_SECRET` — `openssl rand -hex 32`. A secret shorter than 16
   chars is now warned about at startup; an unset one gets a random per-boot
   value (tokens just won't survive a restart).
3. **Pin CORS.** Set `MIDAS_CORS_ORIGIN` to your terminal's exact origin
   (e.g. `https://midas.example.com`). The wildcard default is fine for a
   token-authenticated API but pinning is defense-in-depth, and it is
   **required** for the no-auth trading override.
4. **Set a request ceiling.** `MIDAS_RATE_LIMIT_RPM=120` (or to taste) so one
   client can't monopolize the box. Demo mode turns this on automatically.
5. **Exchange keys are trade-scoped, never withdrawal-scoped.** Midas has no
   withdrawal code path, so a withdrawal-enabled key buys you nothing and
   risks everything. IP-allowlist the key at the exchange too.
6. **Set the notional caps to what you can afford to lose to a bug** — yours
   or an exchange's. `MIDAS_MAX_ORDER_USD` and `MIDAS_MAX_DAILY_USD` are your
   blast radius. A malformed value now fails *safe* (falls back to the default
   and logs it) rather than silently disabling the cap.
7. **Per-user keys need their own secret.** If you enable `MIDAS_KEYS_KMS_SECRET`
   (hosted multi-user), generate it the same way (`openssl rand -hex 32`) and
   back it up — losing it makes every stored key undecryptable (fail-closed).

## Environment-variable security matrix

| Variable | Default | Security role |
|---|---|---|
| `MIDAS_AUTH_ENABLED` | `false` | Require login for the whole API. **On** for any shared/exposed box. |
| `MIDAS_AUTH_SECRET` | random/boot | HMAC key for session tokens. Set a fixed ≥16-char value; warned if weak. |
| `MIDAS_AUTH_ALLOW_SIGNUP` | `true` | Open registration. Turn **off** after creating your accounts. |
| `MIDAS_CORS_ORIGIN` | `*` | Allowed browser origin. Pin it; required (non-`*`) for no-auth trading. |
| `MIDAS_RATE_LIMIT_RPM` | `0` (off) | Per-IP request ceiling. Set it on any public box. |
| `MIDAS_TRADING_ENABLED` | `false` | Master switch for live order placement. Your kill switch. |
| `MIDAS_TRADING_ALLOW_NO_AUTH` | `false` | Permits trading without login — only on a trusted host, only with pinned CORS. |
| `MIDAS_MAX_ORDER_USD` | `1000` | Hard per-order notional cap. Fails safe on a bad value. |
| `MIDAS_MAX_DAILY_USD` | `5000` | Cumulative UTC-day cap. Fails safe on a bad value. |
| `MIDAS_CCXT_API_KEY` / `_SECRET` | empty | Operator exchange keys. **Trade-scoped, never withdrawal.** |
| `MIDAS_KEYS_KMS_SECRET` | empty | Enables per-user keys, AES-256-GCM at rest. Back it up; loss = fail-closed. |
| `MIDAS_MAX_KEYED_USERS` | `25` | Bounds per-user background loops. |
| `ANTHROPIC_API_KEY` | empty | AI copilot key. Requests are bounded (12 messages, 32k chars). |

## The trading-gate stack

Live order placement requires **every** gate to pass — defense in depth, all
enforced server-side in `apps/server/src/trading.ts` (pure, unit-tested) before
the single `createOrder` call:

```
MIDAS_TRADING_ENABLED=true
  └─ ccxt provider with trade-permissioned keys
       └─ auth enabled  (or MIDAS_TRADING_ALLOW_NO_AUTH=true AND pinned CORS)
            └─ per-order notional ≤ MIDAS_MAX_ORDER_USD   (fail-safe)
                 └─ day's cumulative notional ≤ MIDAS_MAX_DAILY_USD  (fail-safe)
                      └─ for a keyed user: their key is canTrade AND usable
                           └─ writes go to THEIR client, never the operator's
```

If any check fails, `/api/trading/status` reports exactly which one, and the
order is refused with that reason. The master switch is the kill switch: set
`MIDAS_TRADING_ENABLED=false` and restart to stop placement instantly.

## Guarantees the codebase enforces (verified by tests)

These are invariants, not aspirations — each has a test that fails CI if it
regresses:

- **Caps fail safe.** Every numeric env var (`numEnv` in `config.ts`) rejects
  NaN/negative/Infinity and falls back to its shipped default, loudly. A typo
  in a money cap can never silently mean "uncapped".
- **The input edges are bounded.** Symbols are charset+length checked at every
  route; the public WebSocket validates channel/symbol, caps frame size,
  bounds subscriptions per socket, and ceilings total upstream sources;
  per-user snapshot blobs are size-capped (413); the AI endpoint bounds
  message count and volume.
- **Exchange ids are allowlisted.** Keys can only be stored for a real ccxt
  exchange id — a crafted value like `constructor` is rejected at the edge,
  before anything is encrypted or stored.
- **Auth is timing-safe.** Tokens verify with `timingSafeEqual`; login runs a
  scrypt compare whether or not the username exists, so response time can't
  enumerate accounts; passwords are scrypt with a per-user random salt.
- **Secrets never leave the server.** Stored keys are AES-256-GCM at rest,
  returned only as metadata (exchange + last 4 + canTrade), and never logged.
  A raw exchange error on the write path is logged server-side but returned to
  the caller only as a bounded, class-only message — request internals can't
  leak in a response.
- **Every write is audited with its outcome.** Order place/cancel log the
  actor and the result (order id + status, or the failure) as structured JSON,
  independent of whether an operator webhook is configured.

## What is deliberately *not* in the app

Kept out on purpose — these are the reverse proxy's or the platform's job, and
baking them into a JSON API server would be scope creep:

- **HSTS and CSP headers.** The API serves JSON and ships baseline headers
  (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`). HSTS
  belongs at your TLS terminator; a CSP belongs wherever the static web bundle
  is served. Add them there.
- **A bespoke monitoring stack.** Security events (failed-login throttling,
  cap rejections, key writes, order placements) are emitted as structured
  pino JSON in your existing log pipeline — greppable by message. Ship those
  logs where you already ship logs.
- **Withdrawal / transfer.** There is no code path. This is not a setting.

## Secret scanning

- GitHub secret scanning + push protection should be **on** for the repo
  (Settings → Code security). It blocks a committed key before it lands.
- `pnpm audit` / Dependabot (`.github/dependabot.yml`, weekly) cover dependency
  CVEs; the four gates are the merge bar for its PRs.
- If a key ever reaches a commit: rotate it at the exchange **first**, then
  scrub history. Rotation is what protects you; scrubbing is cleanup.
