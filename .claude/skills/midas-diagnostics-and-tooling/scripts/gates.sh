#!/usr/bin/env bash
# gates.sh — run Midas gates and print an unambiguous PASS/FAIL table.
#
# Why this exists: MEASURE "am I green?" instead of eyeballing scrolled output.
# It always runs from the repo root (so `check-bundle.mjs` never hits its
# wrong-directory exit-2 trap), runs each gate to completion, and reports a
# per-gate verdict plus one overall exit code (0 = all green).
#
# Usage:
#   bash gates.sh            # FAST tier: typecheck + reviewer demo + bundle(if dist)
#   bash gates.sh --full     # FULL merge bar, in CI order: reviewer, typecheck,
#                            #   build, bundle, tests  (rebuilds web; ~2-3 min)
#   bash gates.sh --help
#
# This is a convenience runner, NOT the merge authority. CI (.github/workflows/
# ci.yml) is the source of truth for the gate set and order — see
# midas-build-and-env. Read-only: it never writes repo files, commits, or
# touches the network (mock/reviewer paths only).
set -u

MODE="fast"
case "${1:-}" in
  --full) MODE="full" ;;
  --help|-h)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "unknown arg: $1 (try --help)"; exit 2 ;;
esac

# Repo root = git toplevel if available, else 4 dirs up from this script
# (<root>/.claude/skills/midas-diagnostics-and-tooling/scripts/gates.sh).
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null \
        || (cd "$(dirname "$0")/../../../.." && pwd))"
cd "$ROOT" || { echo "cannot cd to repo root"; exit 2; }
echo "repo root: $ROOT"
echo "mode:      $MODE"
echo

PASS=0; FAIL=0
declare -a RESULTS

run_gate() {   # run_gate "<label>" <command...>
  local label="$1"; shift
  local start end rc
  start=$(date +%s)
  printf '── %s\n' "$label"
  if "$@" > "/tmp/gate.$$.log" 2>&1; then rc=0; else rc=$?; fi
  end=$(date +%s)
  if [ "$rc" -eq 0 ]; then
    PASS=$((PASS+1)); RESULTS+=("PASS  $label  ($((end-start))s)")
    printf '   PASS (%ss)\n\n' "$((end-start))"
  else
    FAIL=$((FAIL+1)); RESULTS+=("FAIL  $label  (exit $rc, $((end-start))s)")
    printf '   FAIL (exit %s, %ss) — last 15 lines:\n' "$rc" "$((end-start))"
    tail -15 "/tmp/gate.$$.log" | sed 's/^/   | /'; printf '\n'
  fi
  rm -f "/tmp/gate.$$.log"
}

bundle_gate() {   # skip cleanly if there is no build to measure
  if [ ! -d "apps/web/dist/assets" ]; then
    RESULTS+=("SKIP  bundle budget  (no apps/web/dist — build first)")
    printf '── bundle budget\n   SKIP — no apps/web/dist/assets; run a web build first\n\n'
    return
  fi
  run_gate "bundle budget (check-bundle.mjs, from root)" node scripts/check-bundle.mjs
}

if [ "$MODE" = "full" ]; then
  # Mirror CI order exactly: reviewer, typecheck, build, bundle, test.
  run_gate "reviewer demo (test:reviewer)"       pnpm test:reviewer
  run_gate "typecheck (all 3 packages)"          pnpm -r typecheck
  run_gate "build (server tsc + web vite build)" pnpm build
  bundle_gate
  run_gate "tests (server + web vitest)"         pnpm -r test
else
  # FAST tier: no rebuild. Bundle reflects the LAST build (may be stale).
  run_gate "typecheck (all 3 packages)"          pnpm -r typecheck
  run_gate "reviewer demo (test:reviewer)"       pnpm test:reviewer
  bundle_gate
fi

echo "════════ SUMMARY ════════"
for line in "${RESULTS[@]}"; do echo "  $line"; done
echo "  ── pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ] || { echo "  RESULT: RED"; exit 1; }
echo "  RESULT: GREEN"
