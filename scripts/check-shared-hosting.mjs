#!/usr/bin/env node
/**
 * Shared-hosting doc ↔ config alignment gate.
 *
 * - Every MIDAS_* flag listed in docs/SHARED_HOSTING.md's marked table must
 *   appear in apps/server/src/config.ts (or be an intentional allowlisted alias).
 * - Execution safety hold source must still encode enabled:false / TradingSafetyHold.
 * - HOSTED_GO_LIVE must still name the smoke gate and core multi-user flags.
 *
 * Pure filesystem reads + optional import of trading hold helper. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');

const FLAG_BEGIN = '<!-- shared-hosting-flags:begin -->';
const FLAG_END = '<!-- shared-hosting-flags:end -->';
const FLAG_RE = /`?(MIDAS_[A-Z0-9_]+)`?/g;

/** Flags documented in the checklist that live outside config.ts string literals. */
const CONFIG_ALIASES = new Set([
  // Read via env() helper in config — still must appear as env('MIDAS_…')
]);

/**
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractSharedHostingFlags(markdown) {
  const start = markdown.indexOf(FLAG_BEGIN);
  const end = markdown.indexOf(FLAG_END);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('SHARED_HOSTING.md missing shared-hosting-flags markers');
  }
  const block = markdown.slice(start + FLAG_BEGIN.length, end);
  const found = new Set();
  for (const m of block.matchAll(FLAG_RE)) {
    found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * @param {string} configSource
 * @returns {Set<string>}
 */
export function extractConfigEnvFlags(configSource) {
  const found = new Set();
  const re = /['"](MIDAS_[A-Z0-9_]+)['"]/g;
  for (const m of configSource.matchAll(re)) {
    found.add(m[1]);
  }
  return found;
}

/**
 * @param {string} [root]
 */
export async function checkSharedHosting(root = REPO_ROOT) {
  const checks = [];
  const failures = [];

  function pass(id, detail) {
    checks.push({ id, ok: true, detail });
  }
  function fail(id, detail) {
    checks.push({ id, ok: false, detail });
    failures.push(`${id}: ${detail}`);
  }

  const sharedPath = path.join(root, 'docs/SHARED_HOSTING.md');
  const configPath = path.join(root, 'apps/server/src/config.ts');
  const goLivePath = path.join(root, 'docs/HOSTED_GO_LIVE.md');
  const tradingPath = path.join(root, 'apps/server/src/trading.ts');
  const accountRoutesPath = path.join(root, 'apps/server/src/routes/account.ts');

  for (const [id, p] of [
    ['shared-hosting-doc', sharedPath],
    ['config-source', configPath],
    ['go-live-doc', goLivePath],
    ['trading-source', tradingPath],
    ['account-routes', accountRoutesPath],
  ]) {
    if (!fs.existsSync(p)) {
      fail(id, `missing ${path.relative(root, p)}`);
    }
  }
  if (failures.length) {
    return { ok: false, failures, checks, flags: [] };
  }

  const sharedMd = fs.readFileSync(sharedPath, 'utf8');
  let flags = [];
  try {
    flags = extractSharedHostingFlags(sharedMd);
  } catch (err) {
    fail('flag-markers', err instanceof Error ? err.message : String(err));
    return { ok: false, failures, checks, flags };
  }
  if (flags.length < 8) {
    fail('flag-count', `expected ≥8 multi-user flags, got ${flags.length}`);
  } else {
    pass('flag-count', `${flags.length} flags in SHARED_HOSTING checklist`);
  }

  const configSrc = fs.readFileSync(configPath, 'utf8');
  const configFlags = extractConfigEnvFlags(configSrc);
  const missingInConfig = flags.filter((f) => !configFlags.has(f) && !CONFIG_ALIASES.has(f));
  if (missingInConfig.length) {
    fail(
      'flags-in-config',
      `checklist flags missing from config.ts: ${missingInConfig.join(', ')}`,
    );
  } else {
    pass('flags-in-config', 'every checklist MIDAS_* flag is read in config.ts');
  }

  // HOSTED_GO_LIVE must still name the smoke gate + core multi-user flags.
  const goLive = fs.readFileSync(goLivePath, 'utf8');
  for (const needle of [
    'smoke-hosted.mjs',
    'MIDAS_AUTH_ENABLED',
    'MIDAS_KEYS_KMS_SECRET',
    'MIDAS_RATE_LIMIT_RPM',
    'MIDAS_TRADING_ENABLED',
  ]) {
    if (!goLive.includes(needle)) {
      fail('go-live-core', `HOSTED_GO_LIVE.md missing ${JSON.stringify(needle)}`);
    }
  }
  if (!failures.some((f) => f.startsWith('go-live-core'))) {
    pass('go-live-core', 'HOSTED_GO_LIVE retains smoke gate + core multi-user flags');
  }

  // Safety hold: source contract + runtime helper.
  const tradingSrc = fs.readFileSync(tradingPath, 'utf8');
  if (!tradingSrc.includes('executionSafetyHoldStatus') || !tradingSrc.includes('enabled: false')) {
    fail('hold-source', 'trading.ts must define executionSafetyHoldStatus with enabled: false');
  } else {
    pass('hold-source', 'executionSafetyHoldStatus encodes enabled: false');
  }

  const accountSrc = fs.readFileSync(accountRoutesPath, 'utf8');
  for (const needle of ['TradingSafetyHold', "app.post('/api/orders'", "app.delete('/api/orders/:id'"]) {
    if (!accountSrc.includes(needle)) {
      fail('hold-routes', `account routes missing ${JSON.stringify(needle)}`);
    }
  }
  if (!failures.some((f) => f.startsWith('hold-routes'))) {
    pass('hold-routes', 'POST/DELETE /api/orders remain under TradingSafetyHold');
  }

  // Runtime: hold status helper still returns enabled:false (shipped function).
  try {
    const mod = await import(pathToFileURL(tradingPath).href);
    const status = mod.executionSafetyHoldStatus('test-source');
    if (status?.enabled !== false) {
      fail('hold-runtime', `executionSafetyHoldStatus.enabled === ${status?.enabled}`);
    } else if (!String(status?.reason ?? '').toLowerCase().includes('hold')) {
      fail('hold-runtime', 'executionSafetyHoldStatus.reason does not mention hold');
    } else {
      pass('hold-runtime', 'executionSafetyHoldStatus() returns enabled:false');
    }
  } catch (err) {
    fail('hold-runtime', `import trading.ts failed: ${err instanceof Error ? err.message : err}`);
  }

  // Entry doc must not invent billing product.
  if (/stripe|paid tier|subscription/i.test(sharedMd) && !/no paid tier|no billing|free and open source/i.test(sharedMd)) {
    fail('no-billing-invention', 'SHARED_HOSTING.md appears to invent billing without free/OSS disclaimer');
  } else {
    pass('no-billing-invention', 'SHARED_HOSTING.md keeps free/OSS / no-billing posture');
  }

  return { ok: failures.length === 0, failures, checks, flags };
}

async function main() {
  const result = await checkSharedHosting();
  for (const c of result.checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.detail}`);
  }
  if (result.flags?.length) {
    console.log(`\nflags (${result.flags.length}): ${result.flags.join(', ')}`);
  }
  if (!result.ok) {
    console.error(`\nshared-hosting: ${result.failures.length} failure(s)`);
    process.exit(1);
  }
  console.log('\nshared-hosting: ok');
}

const invokedAsCli =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  main();
}
