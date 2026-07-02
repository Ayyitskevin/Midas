#!/usr/bin/env node
/**
 * Bundle budget — fails CI when the web bundle outgrows what we consider
 * acceptable for a terminal that should open fast on a hotel wifi.
 *
 * Budgets are gzip bytes (what actually crosses the wire):
 * - MAIN: the entry chunk everyone downloads before anything renders.
 * - TOTAL: every JS chunk (panels are lazy-loaded, so this is the ceiling a
 *   long session converges to, not the first paint).
 *
 * Raise a budget deliberately, in the same PR that justifies it.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const MAIN_BUDGET_KB = 155;
const TOTAL_BUDGET_KB = 700;

const dist = join(process.cwd(), 'apps/web/dist/assets');
if (!existsSync(dist)) {
  console.error(`check-bundle: ${dist} not found — run the web build first (pnpm build).`);
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
  if (/^index-/.test(file)) mainKb += gz;
  rows.push({ file, gz });
}

rows.sort((a, b) => b.gz - a.gz);
console.log('Largest chunks (gzip):');
for (const r of rows.slice(0, 5)) console.log(`  ${r.gz.toFixed(1).padStart(7)} KB  ${r.file}`);
console.log(`Main (index-*): ${mainKb.toFixed(1)} KB gzip (budget ${MAIN_BUDGET_KB} KB)`);
console.log(`Total JS:       ${totalKb.toFixed(1)} KB gzip (budget ${TOTAL_BUDGET_KB} KB)`);

const failures = [];
if (mainKb > MAIN_BUDGET_KB) failures.push(`main bundle ${mainKb.toFixed(1)} KB > ${MAIN_BUDGET_KB} KB`);
if (totalKb > TOTAL_BUDGET_KB) failures.push(`total JS ${totalKb.toFixed(1)} KB > ${TOTAL_BUDGET_KB} KB`);
if (failures.length > 0) {
  console.error(`\nBundle budget exceeded: ${failures.join('; ')}`);
  console.error('Either trim the code (lazy-load, drop a dep) or raise the budget deliberately in this file.');
  process.exit(1);
}
console.log('Bundle within budget.');
