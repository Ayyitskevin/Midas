# Shared-instance go-live checklist

Taking a box from "it's running" to "other people can safely be on it." This
complements [`HOSTED_BETA.md`](./HOSTED_BETA.md) (which covers provisioning and
the invite email); here we add the **pre-invite smoke gate** that proves the
security posture before anyone else logs in.

**Operator entry / env flag map:** [`SHARED_HOSTING.md`](./SHARED_HOSTING.md)
(canonical multi-user flags + fail-closed table; verified against `config.ts`).

**Midas is free and open source, forever** — there is no paid tier and no
billing code. This checklist is purely about hardening a multi-user instance;
"go-live" means "safe to invite people," not "charging them."

## 1. Deploy the box

```bash
git clone https://github.com/Ayyitskevin/Midas && cd Midas
./scripts/deploy.sh           # bootstraps .env (random auth secret), builds, health-checks
```

Set the hosted posture in `.env`, then `docker compose up -d --build`:

```bash
MIDAS_DATA_PROVIDER=ccxt                        # live markets
MIDAS_AUTH_ENABLED=true                          # every hosted box requires login
MIDAS_AUTH_ALLOW_SIGNUP=true                     # flip to false once invitees are in
MIDAS_KEYS_KMS_SECRET=$(openssl rand -hex 32)    # per-user keys, encrypted at rest
MIDAS_MAX_KEYED_USERS=25                          # per-user watcher/equity loop cap
MIDAS_RATE_LIMIT_RPM=240                          # per-IP ceiling
MIDAS_CORS_ORIGIN=https://your-host.example.com  # pin to your origin (not *)
# Execution stays safety-held regardless of these; they are legacy:
MIDAS_TRADING_ENABLED=false
```

Put TLS in front (Caddy is two lines). Full posture: [`SECURITY.md`](../SECURITY.md).

## 2. Create your operator admin

The **first** account to sign up becomes admin. Do this yourself before opening
signups to anyone else, so you own the admin slot:

```bash
curl -sX POST https://your-host.example.com/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"you","password":"<a strong password>"}'
```

## 3. Smoke-gate — MUST be green before you invite anyone

`scripts/smoke-hosted.mjs` verifies the three things any key-storing user has to
be able to trust: auth is enforced, stored exchange secrets are **never**
returned by the API, and order execution is **safety-held** (503). Run it against
the live box with your operator login:

```bash
node scripts/smoke-hosted.mjs https://your-host.example.com --user you --pass '<password>'
```

Expect `All green`. **If anything fails, do not invite users** — a failure means
something a user must not see (e.g. a secret leak or execution not held).
Re-run this after every upgrade. Then load-check per `HOSTED_BETA.md §3`
(`node scripts/loadtest.mjs …`).

## 4. Invite

Use the invite email in [`HOSTED_BETA.md §4`](./HOSTED_BETA.md). Have the user
run `START` (tour), then `KEYS` to paste a **read-only** exchange key — their
`BAL/ORD/POSN/FILLS/AEQ` and alerts go live and stay isolated to them.

Once your invitees are in, set `MIDAS_AUTH_ALLOW_SIGNUP=false` and restart to
close public signup.

## Go / no-go

- [ ] `docker compose ps` — `server` + `web` up; `SYS` panel shows loops green.
- [ ] `node scripts/smoke-hosted.mjs https://your-host … --user … --pass …` → **All green**.
- [ ] TLS terminates in front; `MIDAS_CORS_ORIGIN` pinned to your origin.
- [ ] You own the admin account; `MIDAS_AUTH_ALLOW_SIGNUP=false` after invites.
- [ ] `MIDAS_KEYS_KMS_SECRET` set (per-user keys on) and backed up — losing it
      makes stored keys unrecoverable.

## Weekly

- `SYS` on the instance: loops green, version current.
- Re-run the smoke gate after any `docker compose … --build` upgrade.
- Read the operator digest (`MIDAS_DIGEST_HOURS`); collect the friction list.
