# Self-hosting for a team

How to run a shared, multi-user Midas instance — hardened, per-user, and honest
about what it is. Everything here uses stock Midas; there is no hosted-only code.

**Midas is free and open source, forever.** Self-hosting — for yourself or for a
team on one box — costs nothing and gates nothing. There is no paid tier and no
billing code; this runbook is just the hardened posture for putting more than
one person on an instance.

## 1. Provision a box

Any 1–2 GB VPS runs a desk of users comfortably. Per instance:

```bash
git clone https://github.com/Ayyitskevin/Midas && cd Midas
./scripts/deploy.sh        # bootstraps .env (random auth secret), builds, health-checks
```

Then set the hosted posture in `.env` and restart (`docker compose up -d`):

```bash
MIDAS_DATA_PROVIDER=ccxt          # live markets
MIDAS_AUTH_ENABLED=true           # every hosted box requires login
MIDAS_AUTH_ALLOW_SIGNUP=true      # flip to false once your invitees are in
MIDAS_KEYS_KMS_SECRET=$(openssl rand -hex 32)   # per-user keys, encrypted at rest
MIDAS_MAX_KEYED_USERS=25          # per-user watcher/equity loop cap
MIDAS_RATE_LIMIT_RPM=240          # per-IP ceiling; keep public surfaces boring
MIDAS_ACCOUNT_WATCH_MS=10000      # fill events for keyed users
MIDAS_EQUITY_SNAP_MS=3600000      # hourly equity snapshots per keyed user
# Legacy execution flags remain false; the server safety hold cannot be bypassed:
MIDAS_TRADING_ENABLED=false
MIDAS_MAX_ORDER_USD=1000
MIDAS_MAX_DAILY_USD=5000
```

Put TLS in front (Caddy is two lines) and pin `MIDAS_CORS_ORIGIN` to the
site origin. The full checklist lives in
[SECURITY.md](https://github.com/Ayyitskevin/Midas/blob/main/SECURITY.md).

**Deployment shapes:** solo = one instance, one user, keys + alerts + digest.
Team = one instance, `MIDAS_AUTH_ALLOW_SIGNUP` for the group and per-user read
keys. Per-user account reads and feeds are isolated; execution is not part of a
hosted instance.

## 2. Onboard a user

1. Create their login (or let them sign up while signups are open).
2. Have them run `START` (tour), then `KEYS` — they paste their **own**
   exchange API key (read-only recommended; never withdrawal-enabled).
   Their `BAL / ORD / POSN / FILLS / AEQ` now show *their* account; fill
   toasts and the equity curve are theirs alone.
3. Set `MIDAS_DIGEST_HOURS=24` + `MIDAS_ALERT_WEBHOOK` if they want the
   morning P&L recap.
4. Confirm the `TICKET` panel says preview-only and `ORD` says read-only. Existing
   exchange orders are managed at the exchange.

## 3. Before inviting anyone: load-check the box

```bash
node scripts/loadtest.mjs http://localhost:8080 --seconds 30 --concurrency 25
```

Aim for p95 under ~250ms on quotes with zero non-200s at 25 concurrent.
The default rate limit (240 rpm/IP) will show up as 429s if you push one IP
harder — that's it working, not breaking.

## 4. The invite email (copy, adjust, send)

> **Subject: Your Midas instance is live**
>
> Hey {name} — your Midas instance is ready:
>
> **URL:** https://{instance}.example.com
> **Login:** {username} / {temporary password} (change it with `AUTH` →
> password)
>
> Three things to try in your first five minutes:
> 1. Run `START` — the 6-click tour of the command grammar.
> 2. Run `KEYS` and paste a **read-only** API key from your exchange —
>    your balances, orders, positions and fills go live instantly. Keys are
>    encrypted at rest and never displayed again; Midas cannot withdraw.
> 3. Run `ALERT` and hit the ⚡ templates — funding flip, ±5% move, equity
>    drawdown.
>
> The honest part: Midas is **free and open source** — nothing is billed, ever,
> whether you use this instance or self-host your own. If you're up for it, I'd
> love one reply a week: what you used, what annoyed you, what's missing.
>
> Reply to this email with anything — it lands in my actual inbox.

## 5. Weekly

- Read the operator digest; if *you* don't want to read it, fix the digest.
- `SYS` on each instance: loops green, version current.
- Collect the friction list → it becomes roadmap v3.
