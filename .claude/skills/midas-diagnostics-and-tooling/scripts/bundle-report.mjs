#!/usr/bin/env node
/**
 * bundle-report.mjs — a richer, read-only companion to scripts/check-bundle.mjs.
 *
 * check-bundle.mjs is the GATE (exit 1 over budget, exit 2 wrong dir). This is
 * the DIAGNOSTIC: it never fails the build, it always finds the repo root on its
 * own (so the wrong-directory trap can't bite), it reads the SAME budgets out of
 * check-bundle.mjs (so the two can't drift), and it prints explicit HEADROOM
 * (KB and %) plus every chunk — the numbers you need to decide what to trim.
 *
 * Usage (from anywhere):
 *   node <path>/bundle-report.mjs         # show top 15 chunks
 *   node <path>/bundle-report.mjs --all   # show every chunk
 *   node <path>/bundle-report.mjs -n 30   # show top 30
 *
 * Requires a prior web build (apps/web/dist is gitignored). Build with:
 *   cd apps/web && npx vite build    (then run this from anywhere)
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// --- find the repo root by walking up for the pnpm-workspace.yaml marker,
//     starting from this script's own location (cwd-independent). ----------
function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
const root = findRoot(dirname(fileURLToPath(import.meta.url))) ?? findRoot(process.cwd());
if (!root) {
  console.error('bundle-report: could not locate repo root (pnpm-workspace.yaml).');
  process.exit(2);
}

// --- read the budgets from check-bundle.mjs so this reporter never drifts ---
function budgetsFromGate() {
  const fallback = { main: 155, total: 700 };
  try {
    const src = readFileSync(join(root, 'scripts/check-bundle.mjs'), 'utf8');
    const main = src.match(/MAIN_BUDGET_KB\s*=\s*(\d+)/);
    const total = src.match(/TOTAL_BUDGET_KB\s*=\s*(\d+)/);
    return {
      main: main ? Number(main[1]) : fallback.main,
      total: total ? Number(total[1]) : fallback.total,
      source: main && total ? 'scripts/check-bundle.mjs' : 'built-in fallback',
    };
  } catch {
    return { ...fallback, source: 'built-in fallback' };
  }
}
const budget = budgetsFromGate();

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
let limit = 15;
if (argv.includes('--all')) limit = Infinity;
const nIdx = argv.indexOf('-n');
if (nIdx >= 0 && argv[nIdx + 1]) limit = Number(argv[nIdx + 1]) || 15;

// --- measure ---------------------------------------------------------------
const dist = resolve(root, 'apps/web/dist/assets');
if (!existsSync(dist)) {
  console.error(`bundle-report: ${dist} not found.`);
  console.error('Run a web build first:  cd apps/web && npx vite build');
  process.exit(2);
}

const kb = (n) => n / 1024;
let mainKb = 0;
let totalKb = 0;
const rows = [];
for (const file of readdirSync(dist)) {
  if (!file.endsWith('.js')) continue;
  const gz = kb(gzipSync(readFileSync(join(dist, file))).length);
  totalKb += gz;
  const isMain = /^index-/.test(file);
  if (isMain) mainKb += gz;
  rows.push({ file, gz, isMain });
}
rows.sort((a, b) => b.gz - a.gz);

// --- report ----------------------------------------------------------------
const pct = (used, cap) => `${((used / cap) * 100).toFixed(1)}%`;
const head = (used, cap) => `${(cap - used).toFixed(1)} KB`;

console.log(`Bundle report — ${dist}`);
console.log(`Budgets read from: ${budget.source}  (main ${budget.main} / total ${budget.total} KB gzip)`);
console.log(`Chunks: ${rows.length} JS files\n`);

console.log(`${limit === Infinity ? 'All' : `Top ${limit}`} chunks (gzip):`);
for (const r of rows.slice(0, limit)) {
  console.log(`  ${r.gz.toFixed(1).padStart(7)} KB  ${r.isMain ? '[main] ' : '       '}${r.file}`);
}

console.log('');
console.log(`  MAIN (index-*): ${mainKb.toFixed(1).padStart(7)} KB / ${budget.main} KB  ·  ${pct(mainKb, budget.main)} used  ·  headroom ${head(mainKb, budget.main)}`);
console.log(`  TOTAL JS:       ${totalKb.toFixed(1).padStart(7)} KB / ${budget.total} KB  ·  ${pct(totalKb, budget.total)} used  ·  headroom ${head(totalKb, budget.total)}`);

const over = [];
if (mainKb > budget.main) over.push(`MAIN over by ${(mainKb - budget.main).toFixed(1)} KB`);
if (totalKb > budget.total) over.push(`TOTAL over by ${(totalKb - budget.total).toFixed(1)} KB`);
console.log('');
console.log(over.length ? `  VERDICT: OVER BUDGET — ${over.join('; ')} (the gate check-bundle.mjs would exit 1)` : '  VERDICT: within budget');
console.log('  (Diagnostic only — the merge gate is `node scripts/check-bundle.mjs` from repo root.)');
