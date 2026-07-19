---
name: midas-config-and-flags
description: >-
  The catalog of every Midas configuration axis — environment variables, their
  defaults, which are production vs legacy, and the operator traps. Load this
  when: you need to know what an env var defaults to or where it is read (`MIDAS_*`,
  `HOST`, `PORT`, `LOG_LEVEL`, `ANTHROPIC_API_KEY`, `VITE_*`); you are adding a new
  config flag or feature toggle; the server throws at startup ("Per-user exchange
  keys require authentication"); you are deciding production vs experimental posture;
  you hit a trap like a corrupt `users.json` aborting boot, lost KMS secret,
  `MIDAS_TRUST_PROXY` / IP-spoofing / rate-limit-to-one-bucket, "why is my numeric
  env ignored", or "does MIDAS_TRADING_ENABLED enable trading" (it does not). Use
  whenever the question is "what config does Midas read, what does it default to,
  and how do I add or change one safely."
---

# Midas config & flags — the catalog

This skill is the **single home** for the Midas env/flag reference table and every
default. Any other skill that needs a default **cross-references here** rather than
restating it (defaults drift; one home prevents skew).

- **Every default below is verified 2026-07-19 @ commit `6b0d5ed` (branch
  `claude/modest-ride-sclvg3`)** by reading the code that *reads* the var — never
  `.env.example`. Each table ships a one-line re-verification command. Re-run them
  before trusting a default; if a number changed, the code is right and this doc is
  stale (fix this doc).
- **Golden rule: verify defaults from `apps/server/src/config.ts`, not from
  `.env.example`.** The `apps/server/.env.example` file is **stale** (see Trap 7).

Terms used throughout: **env var** = an OS environment variable read via
`process.env`. **`Config`** = the single frozen object in `config.ts` built once at
boot. **fail-safe / fail-closed** = on bad input the code reverts to the *safe*
value, never the permissive one.

---

## The two-tier surface (mental model)

Midas reads configuration in **two places**, and you must know which tier a var
lives in before you change it:

1. **Tier A — central `Config` (`apps/server/src/config.ts`).** 31 distinct env keys
   read **once at startup** through two helpers, then frozen into `config` and
   imported everywhere. This is where almost every operator knob lives.
   - `env(key, fallback)` — strings. Empty string or unset → fallback
     (`config.ts:78-81`).
   - `numEnv(key, fallback)` — numbers, **fails SAFE**: unset / `''` / `NaN` /
     negative / non-finite → fallback **plus a `console.warn` to stderr**
     (`config.ts:100-111`). A typo in a money cap reverts to the shipped default
     instead of becoming "uncapped" (Trap 8).
   - Booleans are `env(key,'false').toLowerCase() === 'true'` — only the exact
     string `true` (any case) turns them on.
2. **Tier B — direct `process.env` reads elsewhere** (14 distinct keys, outside
   `config.ts`). These are **lazily read where used** (provider construction, the AI
   route, the logger) and therefore easy to miss — they do **not** appear in the
   `Config` object. Mostly exchange credentials + on-chain sources.

Plus **Tier C — web build / compose-level** vars (`VITE_*`, `MIDAS_WEB_PORT`,
`SMOKE_*`) that never reach the server process.

---

## Tier A — central startup config (`apps/server/src/config.ts`)

**Verified 2026-07-19 @ `6b0d5ed`.** Re-verify every default in one line:

```bash
rg -n "^\s+\w+: (num)?[eE]nv\(" apps/server/src/config.ts   # every field + its default, inline
```

| Env var | Controls | Default | file:line |
|---|---|---|---|
| `HOST` | Server bind host | `0.0.0.0` | config.ts:132 |
| `PORT` | Server bind port | `4000` | config.ts:133 |
| `MIDAS_TRUST_PROXY` | Trusted reverse-proxy hops; `>0` derives `req.ip` from `X-Forwarded-For`. See Trap 4. | `0` (compose overrides → `1`) | config.ts:134 |
| `MIDAS_DATA_PROVIDER` | Active data provider: `mock`\|`yahoo`\|`ccxt` (lowercased). Unknown → warn + mock. | **`mock`** | config.ts:135 |
| `MIDAS_CORS_ORIGIN` | Allowed browser origin (`*` = any) | `*` | config.ts:136 |
| `MIDAS_AI_MODEL` | Claude model id for the AI copilot | `claude-sonnet-4-6` | config.ts:137 |
| `MIDAS_ALERTS_FILE` | Alert store JSON | `${MIDAS_DATA_DIR}/alerts.json` | config.ts:138 |
| `MIDAS_ALERT_INTERVAL_MS` | Alert-loop eval cadence (ms) | `15000` | config.ts:139 |
| `MIDAS_ALERT_WEBHOOK` | Outbound webhook for fired alerts + operator digest | `''` (off) | config.ts:140 |
| `MIDAS_AUTH_ENABLED` | Require login for API + terminal | `false` | config.ts:141 |
| `MIDAS_AUTH_ALLOW_SIGNUP` | Ongoing open registration. First account bootstraps while store empty; then closed unless `true`. | `false` | config.ts:142 + `authAllowSignupEnv()`:88-90 |
| `MIDAS_AUTH_SECRET` | HMAC secret for session tokens. Unset → random per-boot (tokens die on restart). `<16` chars → startup warn (`app.ts:137-142`). | `''` | config.ts:143 |
| `MIDAS_USERS_FILE` | User store JSON | `${MIDAS_DATA_DIR}/users.json` | config.ts:144 |
| `MIDAS_WORKSPACES_FILE` | Per-user workspace snapshots | `${MIDAS_DATA_DIR}/workspaces.json` | config.ts:145-148 |
| `MIDAS_PORTFOLIO_FILE` | Per-user portfolio snapshots | `${MIDAS_DATA_DIR}/portfolio.json` | config.ts:149-152 |
| `MIDAS_WATCHLISTS_FILE` | Per-user watchlist snapshots | `${MIDAS_DATA_DIR}/watchlists.json` | config.ts:153-156 |
| `MIDAS_NOTES_FILE` | Per-user notes snapshots | `${MIDAS_DATA_DIR}/notes.json` | config.ts:157 |
| `MIDAS_TRADING_ENABLED` | **LEGACY** master switch — retained, **IGNORED during the safety hold** (Trap 5) | `false` | config.ts:158 |
| `MIDAS_TRADING_ALLOW_NO_AUTH` | **LEGACY** no-auth override — IGNORED during hold | `false` | config.ts:159 |
| `MIDAS_MAX_ORDER_USD` | **LEGACY** per-order notional cap (0 = uncapped) | `1000` | config.ts:160 |
| `MIDAS_MAX_DAILY_USD` | **LEGACY** cumulative UTC-day cap (0 = uncapped) | `5000` | config.ts:161 |
| `MIDAS_ACCOUNT_WATCH_MS` | Operator account-watcher poll cadence (ms; 0 = off; floored to 2000 at use) | `10000` | config.ts:162 |
| `MIDAS_DIGEST_HOURS` | Operator digest cadence (h; 0 = off; floored to 1). Needs `MIDAS_ALERT_WEBHOOK`. | `0` | config.ts:163 |
| `MIDAS_EQUITY_SNAP_MS` | Equity snapshot cadence (ms; 0 = off; floored to 60000) | `3600000` (hourly) | config.ts:164 |
| `MIDAS_EQUITY_FILE` | Equity snapshot series JSON | `${MIDAS_DATA_DIR}/equity.json` | config.ts:165 |
| `MIDAS_DEMO_MODE` | Public-demo posture (see below) | `false` | config.ts:166 |
| `MIDAS_KEYS_KMS_SECRET` | Secret encrypting per-user exchange keys at rest. `''` = **feature off**. Requires auth (Trap 1). | `''` | config.ts:167 |
| `MIDAS_KEYS_FILE` | Per-user key store JSON | `${MIDAS_DATA_DIR}/user-keys.json` | config.ts:168 |
| `MIDAS_RATE_LIMIT_RPM` | Per-IP request ceiling (req/min; 0 = off) | `0` (demo → 120) | config.ts:169 |
| `MIDAS_MAX_KEYED_USERS` | Keyed users allowed to run per-user background loops (Trap 6) | `25` | config.ts:170 |
| `MIDAS_DATA_DIR` | Base dir for every `*_FILE` store above (read inline in each default) | `./data` | config.ts:138,144,147,151,155,157,165,168 |

### Demo-mode override — one flag makes a box safe to expose

`applyDemoMode` (`config.ts:118-129`) runs **last**, over the base config. When
`MIDAS_DEMO_MODE=true` it **forces** regardless of everything else:
`provider='mock'`, `tradingEnabled=false`, `tradingAllowNoAuth=false`,
`authAllowSignup=false`, and `rateLimitRpm = rpm>0 ? rpm : 120`. Set this on any
public demo and the other flags cannot make it unsafe.

---

## Tier B — direct `process.env` reads (NOT in `config.ts`)

**Verified 2026-07-19 @ `6b0d5ed`.** Re-list the distinct keys in one line:

```bash
rg -oN --no-filename "process\.env\.([A-Z_0-9]+)" apps/server/src -g '!*.test.ts' -g '!config.ts' -r '$1' | sort -u
```

| Env var | Controls | Default | file:line |
|---|---|---|---|
| `LOG_LEVEL` | Fastify/pino log level | `info` | app.ts:72 |
| `ANTHROPIC_API_KEY` | AI copilot upstream key; **unset → `/api/ai/chat` returns 503** | unset | routes/ai.ts:27 |
| `MIDAS_CCXT_EXCHANGE` | ccxt exchange id for market data | `binance` | providers/ccxt.ts:98, ccxt-stream.ts:82 |
| `MIDAS_CCXT_API_KEY` | Operator read/trade API key (BAL/ORD/POSN/FILLS go live) | unset | providers/ccxt.ts:115,181, balances.ts:28 |
| `MIDAS_CCXT_SECRET` | Operator API secret | unset | providers/ccxt.ts:116,182, balances.ts:28 |
| `MIDAS_CCXT_PASSWORD` | Operator passphrase (OKX/KuCoin etc.) | unset | providers/ccxt.ts:117,184 |
| `MIDAS_CCXT_EXCHANGE_2` | Optional 2nd keyed venue id | `''` | providers/ccxt.ts:131 |
| `MIDAS_CCXT_API_KEY_2` | 2nd-venue key (merged account view) | unset | providers/ccxt.ts:132 |
| `MIDAS_CCXT_SECRET_2` | 2nd-venue secret | unset | providers/ccxt.ts:133 |
| `MIDAS_CCXT_PASSWORD_2` | 2nd-venue passphrase | unset | providers/ccxt.ts:138 |
| `MIDAS_CCXT_COMPARE` | Venues compared in the ALLQ multi-exchange module (CSV) | `binance,coinbase,kraken,bitfinex,okx,kucoin` | providers/ccxt.ts:921 |
| `MIDAS_SOLANA_RPC` | Solana JSON-RPC URL → live SOLNET/SWAL/SVAL/SSTAKE/SPL (read-only) | `''` (off → synthetic) | solana/rpc.ts:21 |
| `MIDAS_SOLANA_JUPITER` | Live read-only Jupiter swap **quotes** (SJUP); `1` or a full `.../quote` URL. Quote only, never a swap. | `''` (off) | solana/jupiter.ts:28,34 |
| `MIDAS_DEX_SOURCE` | On-chain/DEX source: `geckoterminal` or `dexscreener` | `''` (off) | providers/geckoterminal.ts:18, dexscreener.ts:18 |

All exchange/RPC creds are **read-only** market/account access — non-custody
invariant holds (owned by `midas-architecture-contract`). Secrets are never logged
or returned.

---

## Tier C — web build / compose-level (never reach the server process)

Owned in **usage** by `midas-run-and-operate` (deploy/topology) and
`midas-build-and-env` (build); catalogued here.

| Var | Controls | Default | file:line |
|---|---|---|---|
| `VITE_API_BASE` | API base URL baked into the web bundle (empty = same origin via nginx) | `''` | apps/web/src/lib/api.ts:54 |
| `VITE_API_TARGET` | Dev/preview proxy target for `/api` | `http://localhost:4000` | apps/web/vite.config.ts:6 |
| `VITE_MIDAS_STATIC_DEMO` | Build the static offline demo (`=== 'true'`) | unset | apps/web/src/main.tsx:14 |
| `MIDAS_WEB_PORT` | Host port the terminal is published on (**compose port mapping only** — not read by the server) | `8080` | docker-compose.yml:88, deploy.sh:52 |
| `SMOKE_USER` / `SMOKE_PASS` | Creds for `scripts/smoke-hosted.mjs` (or `--user`/`--pass`) | from flags | scripts/smoke-hosted.mjs:33-34 |

---

## Which flags are PRODUCTION vs LEGACY/EXPERIMENTAL

- **Production knobs** (operators set these): `MIDAS_DATA_PROVIDER`,
  `MIDAS_AUTH_ENABLED`, `MIDAS_AUTH_ALLOW_SIGNUP`, `MIDAS_AUTH_SECRET`,
  `MIDAS_TRUST_PROXY`, `MIDAS_CORS_ORIGIN`, `MIDAS_RATE_LIMIT_RPM`,
  `MIDAS_KEYS_KMS_SECRET`, `MIDAS_MAX_KEYED_USERS`, `MIDAS_ALERT_*`,
  `MIDAS_ACCOUNT_WATCH_MS`, `MIDAS_EQUITY_SNAP_MS`, `MIDAS_DIGEST_HOURS`, the ccxt
  creds, the Solana/DEX sources, `ANTHROPIC_API_KEY`, `MIDAS_DEMO_MODE`.
- **LEGACY / dead-during-hold** (present, parsed into `Config`, but NOT execution
  authority): `MIDAS_TRADING_ENABLED`, `MIDAS_TRADING_ALLOW_NO_AUTH`,
  `MIDAS_MAX_ORDER_USD`, `MIDAS_MAX_DAILY_USD`. See Trap 5. Do **not** tell an
  operator these enable trading.

---

## Operator traps (the ones that bite)

### Trap 1 — `MIDAS_KEYS_KMS_SECRET` without auth throws at boot
Setting the KMS secret while `MIDAS_AUTH_ENABLED` is not `true` makes the server
**refuse to start**: `throw new Error('Per-user exchange keys require
authentication. Set MIDAS_AUTH_ENABLED=true or remove MIDAS_KEYS_KMS_SECRET.')`
(`app.ts:156-160`). Per-user keys are meaningless without a user identity, so this
is deliberate. Re-verify: `rg -n "require authentication" apps/server/src/app.ts`.

### Trap 2 — losing the KMS secret = unrecoverable keys
The per-user key store is AES-256-GCM, keyed by `scryptSync(MIDAS_KEYS_KMS_SECRET,
…)` (`keys/crypto.ts:19-28`). `decryptText` **returns null, never throws** on a
wrong/rotated/lost secret (`keys/crypto.ts:39-51`) → the key is treated as unusable
and reads fall to honest `unavailable`. **There is no recovery path**: back up
`MIDAS_KEYS_KMS_SECRET` out-of-band. Rotating it silently invalidates every stored
key (users must re-enter). Threat model (`keys/crypto.ts:8-13`): protects
disk/backups, NOT an attacker who already holds the process env.

### Trap 3 — corrupt-store asymmetry: `users.json` aborts, `user-keys.json` resets
- **`users.json` fails CLOSED** — present-but-unparseable → **startup aborts** with
  a restore message (`auth/users.ts:49-61`). Silently resetting would wipe all
  accounts AND re-open admin bootstrap (empty store ⇒ next signup becomes admin),
  turning a write interruption into an auth-wipe + takeover. Fix by restoring the
  file, not by deleting it.
- **`user-keys.json` fails OPEN** — corrupt → silently starts fresh ("keys are
  re-enterable", `keys/repo.ts:58-60`). Same pattern for the other snapshot repos
  (workspaces/portfolio/watchlists/notes/equity).
Re-verify: `rg -n "Refusing to start|re-enterable" apps/server/src/auth/users.ts apps/server/src/keys/repo.ts`.

### Trap 4 — `MIDAS_TRUST_PROXY` must match the nginx topology
Code default is `0`; the **shipped `docker-compose.yml` sets it to `1`**
(`${MIDAS_TRUST_PROXY:-1}`, line 40) because the server sits behind exactly one
nginx hop that sets `X-Forwarded-For`. Get it wrong and per-IP controls (login
throttle, rate limiter) break:
- **Behind the shipped nginx but set to `0`** → every request looks like it comes
  from nginx's IP → all clients share one rate-limit bucket.
- **Directly exposed but set `>0`** → a client can forge `X-Forwarded-For` and
  **spoof `req.ip`**, evading per-IP limits entirely.
Rule: `1` behind the shipped nginx; `0` if the server is directly exposed.

### Trap 5 — `MIDAS_TRADING_ENABLED` is legacy and does nothing
It parses into `config.tradingEnabled`, but the **execution safety hold** makes
`POST /api/orders` and `DELETE /api/orders/:id` return **503 `TradingSafetyHold`
unconditionally** (`routes/account.ts:95-109` — the `safetyHoldResponse` block) — no env flag, key, or `canTrade`
bypasses it. `app.ts:246-247` and `index.ts:87-88` hardcode `tradingEnabled: false`
in system status ("Legacy MIDAS_TRADING_ENABLED is not execution authority while
held"). The `computeTradingStatus`/ledger machinery in `trading.ts` is dead repair
scaffolding. **The hold is not env-flippable** — only the 9-item re-enable gate (a
maintainer decision) lifts it. The gate and the retraction story are owned by
**`midas-change-control`** (rule) and **`midas-failure-archaeology`** (history).
Re-verify: `rg -n "status\(503\)|safetyHoldResponse" apps/server/src/routes/account.ts`.

### Trap 6 — `MIDAS_MAX_KEYED_USERS` caps loops, not keys or reads
It bounds only how many keyed users run **background loops** (fill watcher + equity
snapshots), enforced at `keys/loops.ts:81` (`sets.size >= maxUsers → onRefused`).
It does **not** cap key writes or per-request reads — beyond the cap, reads still
work and the events/equity routes honestly report "not running". Loop cadences are
floored: watch ≥ 2000 ms, equity ≥ 60000 ms (`app.ts:181-182`).

### Trap 7 — `apps/server/.env.example` is STALE — use the ROOT one
`apps/server/.env.example` is 26 lines and omits auth, per-user keys, KMS, trading,
rate limit, Solana/DEX, digest, equity, and account-watch. The **root
`.env.example`** is the canonical, complete operator file (matches `config.ts` +
the Tier-B vars; `docker-compose.yml` wires them with matching `${VAR:-default}`
defaults). The `*_FILE` overrides are intentionally undocumented there —
`MIDAS_DATA_DIR` is the single documented storage knob. **Never verify a default
from either `.env.example`; verify from `config.ts`** (Golden rule).

### Trap 8 — `numEnv` fails safe (bad number → default + stderr warn)
A malformed numeric env (`MIDAS_MAX_ORDER_USD=1o00`, a negative, `NaN`) does **not**
become "uncapped" or crash — it reverts to the shipped default and prints
`[midas] <KEY>="…" is not a non-negative number — using the default (…)`
(`config.ts:100-111`). If a numeric knob "isn't taking effect", **check stderr for
that warning** — the value was rejected.

### Trap 9 — `MIDAS_AUTH_SECRET`: unset is safer than short
Unset → a strong random secret per boot (tokens just don't survive restart). A
**short operator-supplied** secret (`<16` chars) persists a brute-forceable HMAC
key and only triggers a `warn` (`app.ts:137-142`), not a refusal. Use
`openssl rand -hex 32`.

---

## How to add a new config flag (checklist)

Follow in order. One flag = one concern = one small draft PR (cross-ref
`midas-change-control`).

1. **Pick the tier.** Operator-facing knob read at boot → **Tier A** (`config.ts`);
   it gets fail-safe parsing and one documented home. A provider/route-local
   concern read lazily (like the ccxt creds) → Tier B, but prefer Tier A for
   anything an operator sets.
2. **Pick the reader** (Tier A): numeric + safety/money → `numEnv` (fails safe);
   string → `env`; boolean → `env(key,'false').toLowerCase()==='true'`.
3. **Add a documented field** to the `Config` interface (`config.ts:4-76`) — every
   field carries a `/** … */` comment; match that.
4. **Add it to `baseConfig`** (`config.ts:131-172`) with its default.
5. **If it must be forced safe in demo mode**, add it to `applyDemoMode`
   (`config.ts:118-129`).
6. **Document it in the ROOT `.env.example`** (never the stale server one) with a
   comment block, and **wire it in `docker-compose.yml`** with a matching
   `${VAR:-default}` so compose and code agree. (Compose/deploy detail owned by
   `midas-run-and-operate`.)
7. **If it's a boot-time invariant** (e.g. "X requires Y"), enforce it with a clear
   `throw` in `app.ts`, mirroring the KMS/auth guard (Trap 1).
8. **If it's a secret**, follow the keys pattern: never log or return it; expose
   only metadata (see `keys/repo.ts` `metaFor`). Provenance/secret-handling rules
   are owned by `midas-data-honesty-and-provenance` / `midas-change-control`.
9. **Ship a failing→passing test** for any behavioral change (cross-ref
   `midas-validation-and-qa`). `authAllowSignupEnv()` (`config.ts:88-90`) is the
   pattern for making a security-sensitive default unit-testable.
10. **NEVER add a flag that lifts the execution hold.** The hold is deliberately not
    env-flippable; only the 9-item gate does (owned by `midas-change-control`).

---

## When NOT to use this skill

- **Deploy commands, docker/nginx topology, the `midas-data` volume,
  `writeFileAtomic`, hosted go-live** → `midas-run-and-operate`.
- **Recreating the dev env, CI gate order, pnpm/node pins, tsx-no-compile** →
  `midas-build-and-env`.
- **The execution-hold re-enable gate / how changes are gated** →
  `midas-change-control`.
- **The retraction story (0b83c4f), `trading.ts` dead scaffolding** →
  `midas-failure-archaeology`.
- **Provenance mechanics (`live`/`streamLive`/SIM, labeling)** →
  `midas-data-honesty-and-provenance`.
- **The 6 invariants / non-custody / DataProvider seam** →
  `midas-architecture-contract`.

This skill answers only: *what config does Midas read, what does each default to,
which are production vs legacy, and how do I add one.*

---

## Provenance and maintenance

**All facts verified 2026-07-19 against commit `6b0d5ed` (branch
`claude/modest-ride-sclvg3`), reading the code that reads the var — not
`.env.example`.** Re-verify before trusting; code wins over any doc (including this
one) on drift.

| Fact | Re-verification (read-only) |
|---|---|
| Tier A: 31 distinct keys + every default | `rg -oU "(env\|numEnv)\(\s*'([A-Z_0-9]+)'" apps/server/src/config.ts -r '$2' \| sort -u \| wc -l` (=31); `rg -n "^\s+\w+: (num)?[eE]nv\(" apps/server/src/config.ts` (defaults inline) |
| `env`/`numEnv` semantics (empty→fallback; fail-safe numeric) | Read `apps/server/src/config.ts:78-111` |
| Demo-mode forced overrides | Read `apps/server/src/config.ts:118-129` |
| Tier B: 14 distinct `process.env` keys | `rg -oN --no-filename "process\.env\.([A-Z_0-9]+)" apps/server/src -g '!*.test.ts' -g '!config.ts' -r '$1' \| sort -u` |
| Trap 1: KMS-without-auth boot throw | `rg -n "require authentication" apps/server/src/app.ts` (app.ts:156-160) |
| Trap 2: keys undecryptable on lost secret | Read `apps/server/src/keys/crypto.ts:19-51` |
| Trap 3: users abort / keys reset | `rg -n "Refusing to start\|re-enterable" apps/server/src/auth/users.ts apps/server/src/keys/repo.ts` |
| Trap 4: compose sets trustProxy=1 | `rg -n "MIDAS_TRUST_PROXY" docker-compose.yml apps/server/src/config.ts` |
| Trap 5: hold is unconditional 503; trading hardcoded false | `rg -n "status\(503\)\|safetyHoldResponse" apps/server/src/routes/account.ts`; `rg -n "tradingEnabled: false" apps/server/src/index.ts apps/server/src/app.ts` |
| Trap 6: loop cap location + floors | `rg -n "maxUsers\|Math.max\(2000\|Math.max\(60_000" apps/server/src/keys/loops.ts apps/server/src/app.ts` |
| Trap 7: stale server .env.example | Compare `apps/server/.env.example` (26 lines) vs root `.env.example` |
| Trap 8: numEnv warn string | Read `apps/server/src/config.ts:100-111` |
| Trap 9: auth-secret min length warn | `rg -n "MIN_AUTH_SECRET\|characters" apps/server/src/app.ts` (app.ts:137-142) |
| Tier C web/compose vars | `rg -n "VITE_API_BASE\|VITE_API_TARGET\|VITE_MIDAS_STATIC_DEMO" apps/web/src apps/web/vite.config.ts`; `rg -n "MIDAS_WEB_PORT" docker-compose.yml` |

If a re-verification disagrees with a value above, **the code is authoritative** —
update this table and the affected row, keep the date stamp current, and (if a
behavioral default changed) route the change through `midas-change-control`.
