# Hosted go-live checklist

Taking the hosted tier from "a box is running" to "a paying user is on it" —
revenue-first, no hosted-only code. This complements
[`HOSTED_BETA.md`](./HOSTED_BETA.md) (which covers provisioning and the invite
email); here we add the **pre-invite smoke gate** and the **charging** step.

**Pricing honesty stays intact:** self-hosting is free forever. The hosted tier
is "we run it for you." Intended prices are **$20/mo solo, $49/mo desk**. Billing
is manual (Stripe Payment Links) until the volume justifies self-serve Checkout —
see the SaaS plan's Phase 2.

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

`scripts/smoke-hosted.mjs` verifies the three things a paying, key-storing user
has to be able to trust: auth is enforced, stored exchange secrets are **never**
returned by the API, and order execution is **safety-held** (503). Run it against
the live box with your operator login:

```bash
node scripts/smoke-hosted.mjs https://your-host.example.com --user you --pass '<password>'
```

Expect `All green`. **If anything fails, do not invite users** — a failure means
something a paying user must not see (e.g. a secret leak or execution not held).
Re-run this after every upgrade. Then load-check per `HOSTED_BETA.md §3`
(`node scripts/loadtest.mjs …`).

## 4. Charge (Phase 0 — no code)

1. In Stripe, create two **Payment Links**: $20/mo (solo) and $49/mo (desk).
2. Send the relevant link when you invite a user (or gate the invite on payment —
   your call). Collect payment out-of-band; there is no in-app billing yet.
3. Record who paid. Access today = having an account on the box; when the SaaS
   plan's **Phase 1** lands, you'll flip a payer to the `pro` plan via an admin
   action instead of tracking it in a spreadsheet.

## 5. Invite

Use the invite email in [`HOSTED_BETA.md §4`](./HOSTED_BETA.md) (adjust the
"free beta" wording to your paid framing). Have the user run `START` (tour), then
`KEYS` to paste a **read-only** exchange key — their `BAL/ORD/POSN/FILLS/AEQ` and
alerts go live and stay isolated to them.

Once your invitees are in, set `MIDAS_AUTH_ALLOW_SIGNUP=false` and restart to
close public signup.

## Go / no-go

- [ ] `docker compose ps` — `server` + `web` up; `SYS` panel shows loops green.
- [ ] `node scripts/smoke-hosted.mjs https://your-host … --user … --pass …` → **All green**.
- [ ] TLS terminates in front; `MIDAS_CORS_ORIGIN` pinned to your origin.
- [ ] You own the admin account; `MIDAS_AUTH_ALLOW_SIGNUP=false` after invites.
- [ ] `MIDAS_KEYS_KMS_SECRET` set (per-user keys on) and backed up — losing it
      makes stored keys unrecoverable.
- [ ] Stripe Payment Links created; you know who has paid.

## Weekly

- `SYS` on the instance: loops green, version current.
- Re-run the smoke gate after any `docker compose … --build` upgrade.
- Read the operator digest (`MIDAS_DIGEST_HOURS`); collect the friction list.
