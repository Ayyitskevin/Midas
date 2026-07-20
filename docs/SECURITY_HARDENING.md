# Security hardening playbook

Operator-facing companion to [SECURITY.md](https://github.com/Ayyitskevin/Midas/blob/main/SECURITY.md).
`SECURITY.md` states the posture and how to report a vulnerability; this page
is the concrete pre-exposure checklist and the environment-variable security
matrix for anyone putting Midas on a network other people can reach.

Midas is a read-only research terminal at the HTTP boundary: an empty `.env`
runs the offline mock feed, and the execution safety hold cannot be disabled by
environment flags or stored key metadata.

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
5. **Use read-only exchange keys.** Midas has no withdrawal path and its HTTP
   execution routes are held. A withdrawal-enabled key buys you nothing and
   risks everything. IP-allowlist the key at the exchange too.
6. **Do not treat legacy execution flags as controls.** `MIDAS_TRADING_ENABLED`,
   `MIDAS_MAX_ORDER_USD`, and `MIDAS_MAX_DAILY_USD` are retained for compatibility
   and repair tests; they do not bypass the safety hold.
7. **Per-user keys need their own secret.** If you enable `MIDAS_KEYS_KMS_SECRET`
   (hosted multi-user), generate it the same way (`openssl rand -hex 32`) and
   back it up — losing it makes every stored key undecryptable (fail-closed).
   Enabling this store also disables operator-account fallback for authenticated
   account reads; each user must save their own key. The server refuses to start
   the per-user store unless `MIDAS_AUTH_ENABLED=true`.

## Environment-variable security matrix

| Variable | Default | Security role |
|---|---|---|
| `MIDAS_AUTH_ENABLED` | `false` | Require login for the whole API. **On** for any shared/exposed box. |
| `MIDAS_AUTH_SECRET` | random/boot | HMAC key for session tokens. Set a fixed ≥16-char value; warned if weak. |
| `MIDAS_AUTH_ALLOW_SIGNUP` | `false` | Ongoing open registration. Default closed once your first account exists; set `true` only for deliberate open registration. |
| `MIDAS_CORS_ORIGIN` | `*` | Allowed browser origin. Pin it; required (non-`*`) for no-auth trading. |
| `MIDAS_RATE_LIMIT_RPM` | `0` (off) | Per-IP request ceiling. Set it on any public box. |
| `MIDAS_TRUST_PROXY` | `0` | Trusted reverse-proxy hops. Set to `1` behind a single proxy (the shipped nginx) so per-IP controls see the real client; keep `0` if exposed directly (else `X-Forwarded-For` is spoofable). |
| `MIDAS_TRADING_ENABLED` | `false` | Legacy compatibility flag; ignored by the execution safety hold. |
| `MIDAS_TRADING_ALLOW_NO_AUTH` | `false` | Legacy compatibility flag; cannot bypass the hold. |
| `MIDAS_MAX_ORDER_USD` | `1000` | Legacy repair target; not an active execution control. |
| `MIDAS_MAX_DAILY_USD` | `5000` | Legacy repair target; not an active execution control. |
| `MIDAS_CCXT_API_KEY` / `_SECRET` | empty | Operator account-read keys. Use read-only scope, never withdrawal. |
| `MIDAS_KEYS_KMS_SECRET` | empty | Enables strictly isolated per-user keys, AES-256-GCM at rest. Authenticated users without a usable key get unavailable account data, never operator fallback. Back it up; loss = fail-closed. |
| `MIDAS_MAX_KEYED_USERS` | `25` | Bounds per-user background loops. |
| `ANTHROPIC_API_KEY` | empty | AI copilot key. Requests are bounded (12 messages, 32k chars). |

## GitHub Actions and the OpenCode agent

CI, docs deploy, and the optional OpenCode comment agent live under
`.github/workflows/`. Supply-chain posture (pinned third-party agent action,
least-privilege tokens, no `pull_request_target`, concurrency caps) is audited
in [`WORKFLOW_SECURITY.md`](./WORKFLOW_SECURITY.md). The policy script
`scripts/check-release-governance.mjs` fails when the OpenCode action floats on
`@latest` or ship-path docs reintroduce a feature-session default branch.

## The execution safety hold

Order placement and in-app cancellation stop at the route boundary:

```
POST /api/orders       -> 503 TradingSafetyHold
DELETE /api/orders/:id -> 503 TradingSafetyHold
```

`GET /api/trading/status` always reports preview-only with the hold reason.
Tests exercise trade-marked users, operator-backed users, invalid instruments,
concurrent retries, and cancellation, and assert that provider write methods are
never called. Existing resting orders must be managed directly at the exchange.

## Guarantees the codebase enforces (verified by tests)

These are invariants, not aspirations — each has a test that fails CI if it
regresses:

- **Execution fails closed.** Runtime flags, credentials, key metadata, request
  shape, and retry timing cannot make the HTTP API reach provider writes.
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
- **Secrets never leave the server.** Stored keys are AES-256-GCM at rest and
  returned only as metadata (exchange + last 4 + canTrade).

## What is deliberately *not* in the app

Kept out on purpose — these are the reverse proxy's or the platform's job, and
baking them into a JSON API server would be scope creep:

- **HSTS and CSP headers.** The API serves JSON and ships baseline headers
  (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`). HSTS
  belongs at your TLS terminator; a CSP belongs wherever the static web bundle
  is served. Add them there.
- **A bespoke monitoring stack.** Security events such as failed-login
  throttling and key writes are emitted as structured pino JSON in your existing
  log pipeline. Ship those logs where you already ship logs.
- **Withdrawal / transfer.** There is no code path. This is not a setting.

## Secret scanning

- GitHub secret scanning + push protection should be **on** for the repo
  (Settings → Code security). It blocks a committed key before it lands.
- `pnpm audit` / Dependabot (`.github/dependabot.yml`, weekly) cover dependency
  CVEs; the four gates are the merge bar for its PRs.
- If a key ever reaches a commit: rotate it at the exchange **first**, then
  scrub history. Rotation is what protects you; scrubbing is cleanup.
