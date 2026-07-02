# Hosted beta runbook

How to put the first waitlist users on managed Midas instances — hardened,
per-user, and honest about what the beta is. Everything here uses stock
Midas; there is no hosted-only code.

**Pricing honesty (unchanged):** self-hosting is free forever. The hosted
tier is a *waitlist* — $20/mo solo and $49/mo desk are the intended prices,
**nothing is billed during the beta**, and billing (Stripe Payment Links)
only starts when beta users say it's worth paying for.

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
# Trading stays OFF until a user asks for it and you both understand the gates:
MIDAS_TRADING_ENABLED=false
MIDAS_MAX_ORDER_USD=1000
MIDAS_MAX_DAILY_USD=5000
```

Put TLS in front (Caddy is two lines) and pin `MIDAS_CORS_ORIGIN` to the
site origin. The full checklist lives in
[SECURITY.md](https://github.com/Ayyitskevin/Midas/blob/main/SECURITY.md).

**Tier shapes (product, not code):** solo = one instance, one user, keys +
alerts + digest. Desk = one instance, `MIDAS_AUTH_ALLOW_SIGNUP` for the
team, per-user keys, optionally the trading gates. Per-user isolation is
already enforced by the server (reads-account = writes-account, per-user
budgets, per-user feeds).

## 2. Onboard a beta user

1. Create their login (or let them sign up while signups are open).
2. Have them run `START` (tour), then `KEYS` — they paste their **own**
   exchange API key (read-only recommended; never withdrawal-enabled).
   Their `BAL / ORD / POSN / FILLS / AEQ` now show *their* account; fill
   toasts and the equity curve are theirs alone.
3. Set `MIDAS_DIGEST_HOURS=24` + `MIDAS_ALERT_WEBHOOK` if they want the
   morning P&L recap.
4. Trading only on explicit request: user re-saves keys with "can trade" in
   `KEYS`, you set `MIDAS_TRADING_ENABLED=true` and agree on the caps.

## 3. Before inviting anyone: load-check the box

```bash
node scripts/loadtest.mjs http://localhost:8080 --seconds 30 --concurrency 25
```

Aim for p95 under ~250ms on quotes with zero non-200s at 25 concurrent.
The default rate limit (240 rpm/IP) will show up as 429s if you push one IP
harder — that's it working, not breaking.

## 4. The invite email (copy, adjust, send)

> **Subject: Your Midas beta instance is live**
>
> Hey {name} — thanks for joining the Midas waitlist. Your private beta
> instance is ready:
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
> The honest part: the beta is **free**, and nothing gets billed unless you
> later tell me it's worth $20/month ($49 for a multi-user desk) — self-
> hosting stays free forever either way. In exchange, I'd love one reply a
> week: what you used, what annoyed you, what's missing.
>
> Reply to this email with anything — it lands in my actual inbox.

## 5. Weekly during the beta

- Read the operator digest; if *you* don't want to read it, fix the digest.
- `SYS` on each instance: loops green, version current.
- Collect the friction list → it becomes roadmap v3.
