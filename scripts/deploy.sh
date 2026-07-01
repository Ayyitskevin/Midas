#!/usr/bin/env bash
# Midas — one-command production deploy.
#
#   ./scripts/deploy.sh
#
# What it does:
#   1. Verifies docker + the compose plugin are available.
#   2. Creates .env from .env.example on first run — generating a random
#      MIDAS_AUTH_SECRET so sessions survive restarts the day you enable auth.
#      An existing .env is NEVER touched.
#   3. Builds and starts the stack (docker compose up -d --build).
#   4. Waits for /api/health and prints where the terminal is + next steps.
#
# Safe to re-run: it rebuilds images and restarts containers; your data
# (alerts, users, workspaces, portfolios) lives in the midas-data volume.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '\033[1;33m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. prerequisites -------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker is required — install it from https://docs.docker.com/engine/install/ and re-run."
docker compose version >/dev/null 2>&1 || fail "the docker compose plugin is required (docker compose version failed)."

# --- 2. environment ---------------------------------------------------------
if [ ! -f .env ]; then
  say "No .env found — creating one from .env.example"
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
  else
    SECRET="$(od -vN 32 -An -tx1 /dev/urandom | tr -d ' \n')"
  fi
  awk -v s="MIDAS_AUTH_SECRET=$SECRET" '{ if ($0 ~ /^MIDAS_AUTH_SECRET=/) print s; else print }' .env > .env.tmp \
    && mv .env.tmp .env
  ok "Created .env with a generated MIDAS_AUTH_SECRET (auth itself stays OFF until you enable it)"
else
  ok "Using your existing .env (left untouched)"
fi

# --- 3. build + start -------------------------------------------------------
say "Building and starting Midas (this takes a few minutes on the first run)…"
docker compose up -d --build

# --- 4. health check --------------------------------------------------------
PORT="$( (grep -E '^MIDAS_WEB_PORT=' .env 2>/dev/null || true) | cut -d= -f2 )"
PORT="${PORT:-${MIDAS_WEB_PORT:-8080}}"
URL="http://localhost:${PORT}"

say "Waiting for the terminal to answer at ${URL}/api/health…"
for i in $(seq 1 30); do
  if curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
    ok "Midas is up."
    echo
    echo "  ┌──────────────────────────────────────────────────────────────┐"
    echo "  │  Open ${URL}  and type:  BTC/USDT GP                 │"
    echo "  └──────────────────────────────────────────────────────────────┘"
    echo
    echo "  Next steps (all optional, all in .env — restart with ./scripts/deploy.sh):"
    echo "   • Live market data ..... MIDAS_DATA_PROVIDER=ccxt"
    echo "   • Your real account .... MIDAS_CCXT_API_KEY / _SECRET  (READ-ONLY keys)"
    echo "   • Fill notifications ... on by default with keys (MIDAS_ACCOUNT_WATCH_MS)"
    echo "   • Alert webhook ........ MIDAS_ALERT_WEBHOOK=<discord/slack url>"
    echo "   • Weekly digest ........ MIDAS_DIGEST_HOURS=168"
    echo "   • Multi-user login ..... MIDAS_AUTH_ENABLED=true  (secret already set)"
    echo "   • Live trading ......... read SECURITY.md first — it is off by default"
    echo "   • Public demo box ...... MIDAS_DEMO_MODE=true  (mock data, no trading, no signups)"
    exit 0
  fi
  sleep 2
done

fail "Midas did not answer after 60s — check: docker compose logs server"
