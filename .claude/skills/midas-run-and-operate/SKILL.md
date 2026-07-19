---
name: midas-run-and-operate
description: >-
  Run, deploy, and operate a Midas instance — the RUNTIME anatomy, not the code-change
  workflow. Load this when: starting Midas locally (`pnpm dev`, ports 5173/4000) or via Docker
  (`docker compose up -d`, `./scripts/deploy.sh`, `http://localhost:8080`); reasoning about the
  network topology (nginx on host :8080 → server internal :4000, server never published to host,
  `MIDAS_TRUST_PROXY`); figuring out where state lives (the `midas-data` volume at `/app/data`,
  `writeFileAtomic`, backing up / wiping the volume, boot aborts on a corrupt `users.json`);
  standing up or upgrading a HOSTED beta box (the auth/keys/rate-limit/KMS `.env` posture, the
  first-user-admin bootstrap, `smoke-hosted.mjs`, `loadtest.mjs`, the `MIDAS_KEYS_KMS_SECRET`
  boot invariant); or day-2 ops — "server won't boot", "health check failing", "tail the logs",
  "restart the box", "why is rate-limiting one shared bucket". NOT for looking up an env var's
  default (that is midas-config-and-flags), recreating the build/CI env (midas-build-and-env),
  or deciding whether a change may ship (midas-change-control).
---

# Midas — Run & Operate

The **runtime** playbook: how Midas starts, how the containers wire together, where its state
lives, and how to operate a hosted box. Everything here is about **running** an instance, not
about changing its code.

Terms used throughout: **provider** = the data source (`mock`|`yahoo`|`ccxt`, default `mock`);
**the box** = one deployed Midas instance; **the volume** = the `midas-data` Docker volume where
all persistent JSON lives; **the hold** = the unconditional execution safety hold (order writes
always 503).

---

## 0. Prime directive: operating is NOT a code change

Running `docker compose up`, `./scripts/deploy.sh`, or restarting the server is an **operator**
action against a live box. It is a **separate act** from changing Midas's code.

> **Do NOT deploy, restart, or rebuild a box as part of authoring a code change.** A code change
> ships as one small draft PR and stops at the merge bar — see **midas-change-control**. The
> commands in this skill are for someone *operating an instance*, not for a contributor landing a
> patch. Never treat "it deploys" as evidence a change is correct (that is **midas-validation-and-qa**).

The hold is also non-negotiable at runtime: `POST /api/orders` and `DELETE /api/orders/:id`
return **503 `TradingSafetyHold`** on every box regardless of env, and no hosted posture lifts it.
Lifting it is a maintainer decision gated by the 9-item list in `docs/EXECUTION_SAFETY_HOLD.md`
(owned by **midas-change-control**). Do not add env, flags, or "hosted-only" code to enable trading.

---

## 1. Two ways to run it — at a glance

| | Local dev | Docker (self-host / hosted) |
|---|---|---|
| Command | `pnpm install --frozen-lockfile && pnpm dev` | `docker compose up -d` **or** `./scripts/deploy.sh` |
| Open | web `http://localhost:5173`, api `http://localhost:4000` | `http://localhost:8080` (nginx only) |
| Processes | 2 (Vite dev server + `tsx watch`), no build | 2 containers (`web` nginx + `server` tsx) |
| `/api` routing | Vite dev proxy → `:4000` | nginx reverse-proxy → `server:4000` |
| Data dir | `./data` (cwd-relative, gitignored) | `midas-data` volume at `/app/data` |
| Default provider | `mock` (offline, synthetic) | `mock` (baked into the server image) |
| Reload | Vite HMR + `tsx watch` restart-on-save | rebuild image (`up -d --build`) |

Both default to the **offline `mock` provider** — no network, no keys, deterministic synthetic
data. Live data is opt-in (§2, §3).

---

## 2. Local dev runbook

```bash
pnpm install --frozen-lockfile     # Node 20+ and pnpm 10.33.0 (see midas-build-and-env)
pnpm dev                           # runs web + server together (mock data, no network)
#   → web:  http://localhost:5173
#   → api:  http://localhost:4000
```

`pnpm dev` = `pnpm -r --parallel dev` (root `package.json`): the web package runs `vite`, the
server package runs `tsx watch src/index.ts` — **raw TypeScript, no compile step**. Run one side
alone with `pnpm dev:web` or `pnpm dev:server`.

- **How the browser reaches the API in dev:** the Vite dev server (`apps/web/vite.config.ts`)
  proxies `/api` (REST *and* the `/api/stream` WebSocket, `ws: true`) to `VITE_API_TARGET`
  (default `http://localhost:4000`). So the SPA on `:5173` talks to the Fastify server on `:4000`
  through the same-origin `/api` prefix — the same shape nginx provides in Docker.
- **Where local data goes:** `./data` relative to the server process's cwd — i.e.
  `apps/server/data/` when launched via the pnpm scripts. It is gitignored (`data/`, `**/data/`).
- **Turn on live data** (opt-in, no order execution ever):
  ```bash
  MIDAS_DATA_PROVIDER=yahoo pnpm dev                              # live equities REST (no key)
  MIDAS_DATA_PROVIDER=ccxt MIDAS_CCXT_EXCHANGE=binance pnpm dev   # live crypto + CCXT-Pro streams
  ```
  Only `ccxt` streams live over websockets; `yahoo` is live REST but the stream stays synthetic
  (this is why `live` and `streamLive` are separate — see **midas-data-honesty-and-provenance**).

For the full env-var catalogue and every default, see **midas-config-and-flags** (sole owner).

---

## 3. Docker deploy runbook

### The one command

```bash
./scripts/deploy.sh        # bootstraps .env, builds, starts, health-checks
# ── or by hand, the same two steps: ──
cp .env.example .env       # optional; defaults run the offline mock feed
docker compose up -d       # build + run web + server
open http://localhost:8080
```

### What `scripts/deploy.sh` does (and does not do)

1. Verifies `docker` and the `docker compose` plugin are installed (fails with install hints).
2. **On first run only**, copies `.env.example` → `.env` and injects a **random
   `MIDAS_AUTH_SECRET`** via `openssl rand -hex 32` (falls back to `/dev/urandom` if no openssl).
   This seeds the HMAC session secret so tokens survive restarts *the day you enable auth* —
   **auth itself stays OFF** until you set `MIDAS_AUTH_ENABLED=true`.
3. **Never touches an existing `.env`** — safe to re-run for rebuilds/restarts.
4. `docker compose up -d --build`.
5. Polls `http://localhost:${MIDAS_WEB_PORT:-8080}/api/health` — up to **30 tries × 2s = 60s** —
   then prints the URL and next steps, or fails telling you to run `docker compose logs server`.

Because the secret is generated only when `.env` is absent, deploy.sh is idempotent: your data
(alerts, users, workspaces, portfolios, keys) lives in the volume and is untouched by a re-run.

### The two images (`Dockerfile`, multi-stage, one workspace → two targets)

| Target | Base | Role | Port | Healthcheck |
|---|---|---|---|---|
| `web` | `nginx:1.27-alpine` | serves the built SPA + reverse-proxies `/api` | `EXPOSE 80` | `wget -qO- http://localhost/` |
| `server` | `node:22-bookworm-slim` | Fastify API run under **tsx (no compile)** | `EXPOSE 4000` | `fetch('http://localhost:4000/api/health')` |

The `server` image bakes `HOST=0.0.0.0 PORT=4000 NODE_ENV=production MIDAS_DATA_PROVIDER=mock`
and runs `pnpm --filter @midas/server start` = `tsx src/index.ts`. `@midas/shared` is consumed as
**raw TypeScript**, so there is no `tsc` build for the server — the container ships the `.ts`
sources and tsx executes them directly. (Only the web SPA is truly built, by `vite build`.)

---

## 4. Network topology — who is exposed, who is not

```
                    host :8080 (MIDAS_WEB_PORT)
                          │
   browser ──────────────▼───────────────────────┐
                 ┌─────────────────────┐  /api/*  │  ┌──────────────────────────┐
                 │  web  (nginx:80)    │──proxy──────▶│  server (Fastify :4000)  │
                 │  · serves SPA       │  server:4000 │  · expose: 4000 ONLY     │
                 │  · /assets immutable│              │  · NOT published to host │
                 │  · WS upgrade for   │◀─────────────│  · tsx src/index.ts      │
                 │    /api/stream      │              │  · volume midas-data     │
                 │  · X-Forwarded-For ─┼── one hop ──▶│    → /app/data           │
                 └─────────────────────┘  TRUST_PROXY=1└──────────────────────────┘
```

Ground truth in `docker-compose.yml` + `apps/web/nginx.conf`:

- **`web`** publishes `"${MIDAS_WEB_PORT:-8080}:80"`, `depends_on: server`, `restart: unless-stopped`.
  **This is the only port on the host.** Default host port **8080**.
- **`server`** declares **`expose: "4000"`** — *not* `ports:`. `expose` publishes to linked
  containers only, **never to the host**. The browser can reach the API *exclusively* through
  nginx's `/api/` proxy. Mounts `midas-data:/app/data`, sets `MIDAS_DATA_DIR=/app/data`,
  `restart: unless-stopped`.
- **nginx** (`nginx.conf`): `location /api/` → `proxy_pass http://server:4000` with
  `Upgrade`/`Connection` headers so the `/api/stream` WebSocket upgrades; sets
  `X-Forwarded-For`; `no-cache` on `index.html` (deploys picked up immediately); `expires 1y`
  immutable on `/assets/`; SPA fallback `try_files … /index.html`.
- **`MIDAS_TRUST_PROXY=1`** in compose: the server sits behind **exactly one** nginx hop, so it
  derives `req.ip` from the `X-Forwarded-For` nginx sets — keeping the per-IP rate limiter and
  login throttle honest (one bucket *per client*, not one shared bucket).
  - **Trap:** if you expose the server **directly** (no nginx, e.g. custom compose), set
    `MIDAS_TRUST_PROXY=0` or clients can spoof `req.ip`. Behind 2 proxies (e.g. an extra
    load balancer), it must match the real hop count. The exact semantics/default live in
    **midas-config-and-flags**.

---

## 5. Where state lives — persistence & the volume

**All** durable state is file-backed JSON on the **`midas-data`** volume, base dir `/app/data`
(local dev: `./data`). Repos wired at boot; each file is a `MIDAS_*_FILE` config (defaults from
`MIDAS_DATA_DIR`, catalogue in **midas-config-and-flags**):

| File | Holds |
|---|---|
| `users.json` | accounts (password hashes, admin flag) — **fails CLOSED** (see below) |
| `user-keys.json` | per-user exchange keys, **encrypted** (AES-256-GCM) — fails open |
| `alerts.json` | alert rules + triggers |
| `workspaces.json` / `portfolio.json` / `watchlists.json` / `notes.json` | per-user UI snapshots |
| `equity.json` + per-user `equity-<sanitized-userId>.json` | account equity curves |

### `writeFileAtomic` — the durability core (`apps/server/src/persist.ts:26-70`)

Every `*_FILE` store is written through this one function. The sequence:

1. `mkdir -p` the dir.
2. Write a **sibling temp** `${file}.tmp-${pid}` with **mode `0o600`** (owner-only — these stores
   hold secrets); if the target already exists, `chmod` the temp to preserve its mode.
3. **`fsync` the temp fd** (bytes hit disk before the rename).
4. **`rename()`** temp over target — atomic on POSIX, so a reader/next-boot sees the *old whole*
   or *new whole* file, never a half-written one.
5. Best-effort **`fsync` the directory** (makes the rename itself durable).
6. On any error, `rm` the temp so no partial file lingers.

Why it exists: a plain `writeFileSync` opens with `O_TRUNC` (zeroes the file *first*), so a
SIGKILL on deploy / OOM / `ENOSPC` mid-write would corrupt the store — for `users.json` that
silently wipes every account **and** re-opens admin bootstrap. This close that window.

### Corrupt-store asymmetry (bites operators at boot)

- **`users.json` fails CLOSED** — a present-but-unparseable user store **aborts startup** with a
  restore message (`auth/users.ts:49-61`), deliberately, to prevent an auth wipe + admin
  takeover. **If the server won't boot with a "User store … present but unreadable" error:**
  restore the file from backup, or move it aside to bootstrap a fresh store. Do **not** delete it
  blindly on a live box — you would reset all accounts and hand admin to the next signup.
- **`user-keys.json` fails OPEN** — a corrupt key store silently starts fresh (`keys/repo.ts:53-60`);
  keys are re-enterable. Same pattern for the other snapshot repos.

### Volume lifecycle — backup, keep, wipe

| Goal | Command | Effect on data |
|---|---|---|
| Tail logs | `docker compose logs -f` | none |
| Container status/health | `docker compose ps` | none |
| Stop (keep data) | `docker compose down` | **volume survives** |
| Apply `.env` change / upgrade | `docker compose up -d --build` | **volume survives** |
| **Destroy data** | `docker compose down -v` | **DELETES the `midas-data` volume** ⚠ |

- `docker compose down` removes containers + network but **not** named volumes — data persists
  across restarts and rebuilds. `-v` is the one that wipes it. Never run `down -v` on a box with
  real users/keys unless you intend to erase them.
- **Back up the volume** (standard Docker — no repo script exists for this):
  ```bash
  docker volume ls | grep midas-data     # real name is <compose-project>_midas-data
  docker run --rm -v <project>_midas-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/midas-data-$(date +%F).tgz -C /data .
  ```
- **Also back up `MIDAS_KEYS_KMS_SECRET`** separately (see §6) — the volume's encrypted keys are
  worthless without it.

---

## 6. Hosted-beta operational runbook

Hosted Midas is **stock Midas with a specific env posture** — there is no hosted-only code
(`docs/HOSTED_BETA.md`, `docs/HOSTED_GO_LIVE.md`). Any 1–2 GB VPS runs a desk.

### 6.1 Provision + set the posture

```bash
git clone https://github.com/Ayyitskevin/Midas && cd Midas
./scripts/deploy.sh        # bootstraps .env (random auth secret), builds, health-checks
```

Then set the hosted posture in `.env` and restart (`docker compose up -d --build`):

```bash
MIDAS_DATA_PROVIDER=ccxt                          # live markets
MIDAS_AUTH_ENABLED=true                           # every hosted box requires login
MIDAS_AUTH_ALLOW_SIGNUP=true                      # flip to false once invitees are in
MIDAS_KEYS_KMS_SECRET=$(openssl rand -hex 32)     # per-user keys, encrypted at rest
MIDAS_MAX_KEYED_USERS=25                          # per-user watcher/equity loop cap
MIDAS_RATE_LIMIT_RPM=240                          # per-IP ceiling (HOSTED_BETA value)
MIDAS_CORS_ORIGIN=https://your-host.example.com   # pin to your origin, not *
MIDAS_ACCOUNT_WATCH_MS=10000 ; MIDAS_EQUITY_SNAP_MS=3600000
# Execution stays safety-held regardless; these are legacy and ignored by the hold:
MIDAS_TRADING_ENABLED=false
```

Put **TLS in front** (Caddy is two lines). Execution is **not part of the hosted beta**. These are
prescriptive runbook values; for what each var *means* and its default, see **midas-config-and-flags**.

### 6.2 Two boot invariants you must respect

- **`MIDAS_KEYS_KMS_SECRET` without `MIDAS_AUTH_ENABLED=true` THROWS at startup** — the server
  refuses to run with *"Per-user exchange keys require authentication"* (`apps/server/src/app.ts:156-160`).
  Per-user keys require auth. Set both, or neither.
- **The KMS secret is unrecoverable if lost.** It derives the AES key for every stored per-user
  exchange key. Lose it → all stored keys become permanently undecryptable (users must re-enter).
  **Back it up** out-of-band, separately from the volume.

### 6.3 First-user admin bootstrap (do this before opening signups)

The **first account to sign up becomes admin** (`auth/users.ts:99`, `isAdmin:
this.users.length === 0`; the separate load-time block at `:44-46` only promotes the
earliest user if no admin exists). Self-register *before* inviting anyone so you own the
admin slot:

```bash
curl -sX POST https://your-host.example.com/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"you","password":"<a strong password>"}'
```

After your invitees are in, set `MIDAS_AUTH_ALLOW_SIGNUP=false` and restart to close public signup.

### 6.4 Pre-invite gates — MUST pass before inviting, and after every `--build` upgrade

**Smoke gate** (`scripts/smoke-hosted.mjs`) — verifies the three trust guarantees a paying,
key-storing user relies on: **(1)** auth is enforced (protected routes 401 without a token),
**(2)** stored exchange secrets are **never** returned by the API (write-only keys), **(3)**
execution is **safety-held** (`POST /api/orders` → 503). It never creates an account (won't steal
the admin slot) and deletes the throwaway key it stores.

```bash
node scripts/smoke-hosted.mjs https://your-host.example.com --user you --pass '<password>'
# Expect: "All green".  Exit 0 = green.  Non-zero = a user must-not-see failure → DO NOT INVITE.
```

**Load gate** (`scripts/loadtest.mjs`) — dependency-free; mixes health + real quote/history reads:

```bash
node scripts/loadtest.mjs https://your-host.example.com --seconds 30 --concurrency 25
# Aim: p95 under ~250ms on quotes, ZERO 5xx.  429s under single-IP hammering = the limiter working
# (loadtest exits non-zero only on 5xx / network errors, not on 429s).
```

### 6.5 Rate limiter behavior (operational)

When `MIDAS_RATE_LIMIT_RPM > 0`, a per-IP window limiter runs on **every path except
`/api/health`** (exact match or `/api/health/` prefix — matched on a segment boundary, so
`/api/healthz` is **not** exempt); over-limit → **429 + `retry-after`** (`apps/server/src/app.ts:106-125`).
The AI copilot has its own tighter per-caller cap on top (see midas-config-and-flags). Uptime
monitors should hit `/api/health` so they never trip the limiter.

### 6.6 Charge, weekly ops, go/no-go

- **Charge (Phase 0, no code):** two Stripe **Payment Links** — $20/mo solo, $49/mo desk. Manual,
  out-of-band; nothing is billed during the beta. Self-hosting is free forever.
- **Weekly:** `SYS` panel on each box (loops green, version current); re-run the smoke gate after
  any `docker compose … --build` upgrade; read the operator digest (`MIDAS_DIGEST_HOURS`); collect
  the friction list.
- **Go / no-go before a paying user** (`HOSTED_GO_LIVE.md`):
  - [ ] `docker compose ps` — `server` + `web` up; `SYS` shows loops green.
  - [ ] `smoke-hosted.mjs … --user … --pass …` → **All green**.
  - [ ] TLS terminates in front; `MIDAS_CORS_ORIGIN` pinned to your origin.
  - [ ] You own the admin account; `MIDAS_AUTH_ALLOW_SIGNUP=false` after invites.
  - [ ] `MIDAS_KEYS_KMS_SECRET` set **and backed up**.
  - [ ] Stripe Payment Links created; you know who has paid.

---

## 7. Day-2 quick reference & triage

| Symptom | First check | Likely cause / fix |
|---|---|---|
| Nothing at `:8080` | `docker compose ps` | web/server not up → `docker compose logs server` |
| deploy.sh "did not answer after 60s" | `docker compose logs server` | server crashed at boot (see next rows) |
| Boot loops with "User store … present but unreadable" | `users.json` on the volume | corrupt user store → **restore from backup** (§5); do not delete on a live box |
| Boot throws "Per-user exchange keys require authentication" | `.env` | `MIDAS_KEYS_KMS_SECRET` set but `MIDAS_AUTH_ENABLED` not `true` (§6.2) |
| Rate limit hits every client as one bucket | `MIDAS_TRUST_PROXY` | must be `1` behind the shipped nginx (§4) |
| Sessions drop on every restart | `MIDAS_AUTH_SECRET` | unset → random per-boot; set a stable ≥16-char secret |
| `/api/*` 404/blank in local dev | is `pnpm dev:server` up on `:4000`? | Vite only proxies; the API must be running |
| Health endpoint | `curl http://localhost:8080/api/health` | `apps/server/src/routes/market.ts:95`; reports provider/live/streamLive/version |

Common commands: `docker compose logs -f` (tail), `docker compose ps` (status/health),
`docker compose up -d --build` (apply `.env` change / upgrade), `docker compose down` (stop, keep
data), `docker compose restart server` (bounce just the API).

---

## When NOT to use this skill

| You need… | Use instead |
|---|---|
| An env var's meaning, default, or how to add a flag | **midas-config-and-flags** (owns the env table) |
| To recreate the build/CI env, pnpm/node pins, gate order, bundle budget | **midas-build-and-env** |
| To know whether a change may ship / how deploys are gated / the hold re-enable gate | **midas-change-control** |
| What counts as evidence, the six gates, the reviewer demo | **midas-validation-and-qa** |
| To *measure* something (bundle from root, quota/stream introspection) | **midas-diagnostics-and-tooling** |
| The provenance unions, live vs streamLive vs SIM, labeling a new surface | **midas-data-honesty-and-provenance** |
| The three-tier architecture / DataProvider seam / registration triad | **midas-architecture-contract** |

If you are about to `git commit`/open a PR, or you are asking "is this change allowed to deploy?",
you are in **midas-change-control** territory — operating a box (this skill) is a distinct act.

---

## Provenance and maintenance

All facts verified against the repo on **2026-07-19** (branch state at time of writing). Re-verify
volatile facts with the paired command before relying on them.

| Fact (as stated) | Re-verify |
|---|---|
| Local dev: `pnpm dev` = web `:5173` + server `:4000`; server dev/start = `tsx` (no compile) | `sed -n '12,23p' package.json`; `sed -n '8,14p' apps/server/package.json`; `sed -n '1,35p' apps/web/vite.config.ts` |
| Vite dev proxies `/api`(+ws) → `VITE_API_TARGET` default `http://localhost:4000` | `sed -n '5,28p' apps/web/vite.config.ts` |
| `docker compose up -d` / `./scripts/deploy.sh` → `http://localhost:8080`; provider default `mock` | `sed -n '109,138p' README.md`; `grep -n MIDAS_DATA_PROVIDER Dockerfile docker-compose.yml` |
| deploy.sh: seeds random `MIDAS_AUTH_SECRET` (openssl rand -hex 32) first-run only, never touches existing `.env`; health poll 30×2s=60s | `sed -n '26,78p' scripts/deploy.sh` |
| Topology: web publishes `${MIDAS_WEB_PORT:-8080}:80`; server `expose: "4000"` only (never `ports:`); `MIDAS_TRUST_PROXY=1`; volume `midas-data:/app/data` | `sed -n '77,94p' docker-compose.yml`; `grep -n 'expose\|ports\|TRUST_PROXY\|midas-data' docker-compose.yml` |
| nginx `/api/` → `http://server:4000` with WS upgrade + `X-Forwarded-For`; no-cache index; immutable assets; SPA fallback | `cat apps/web/nginx.conf` |
| Two images: `web` nginx:1.27-alpine EXPOSE 80; `server` node:22-bookworm-slim EXPOSE 4000, `CMD tsx` (raw TS) | `cat Dockerfile` |
| `writeFileAtomic`: temp(0o600)→fsync→rename→dir-fsync→rm-on-error | `sed -n '26,70p' apps/server/src/persist.ts` |
| `users.json` corrupt → aborts startup (fail closed); `user-keys.json` corrupt → silent reset (fail open) | `sed -n '49,61p' apps/server/src/auth/users.ts`; `sed -n '53,61p' apps/server/src/keys/repo.ts` |
| KMS-without-auth throws at boot | `sed -n '150,160p' apps/server/src/app.ts` |
| Rate limiter exempts `/api/health` (segment boundary), 429+retry-after; `MIDAS_RATE_LIMIT_RPM` gate | `sed -n '104,125p' apps/server/src/app.ts` |
| Hosted posture env block; first-user admin; smoke/load gates; $20/$49 | `sed -n '12,45p' docs/HOSTED_BETA.md`; `sed -n '14,96p' docs/HOSTED_GO_LIVE.md` |
| Smoke test checks auth/secret-secrecy/503-hold; exit 0=green, non-zero=do-not-invite | `sed -n '1,25p;132,158p' scripts/smoke-hosted.mjs` |
| Loadtest defaults 30s/25-concurrency; fails only on 5xx/network errors | `sed -n '1,22p;66,72p' scripts/loadtest.mjs` |
| Release version `0.5.0` (single source; reported at `/api/health`) | `sed -n '12p' packages/shared/src/system.ts` |
| Health route path `/api/health` | `grep -n "'/api/health'" apps/server/src/routes/market.ts` |

Note: `package.json` `version` fields read `0.1.0` (npm workspace version) — the **release**
version single-sourced for `/api/health`, the demo, and the update toast is `MIDAS_VERSION` in
`packages/shared/src/system.ts` (code wins over the workspace field). The GitHub org/repo path in
the hosted docs (`Ayyitskevin/Midas`) is copied from those docs, not independently verified.
