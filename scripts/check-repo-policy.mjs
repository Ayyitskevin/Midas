#!/usr/bin/env node
/**
 * Repo-policy honesty gate for Midas.
 *
 * Fails if load-bearing policy docs drift away from:
 * - `main` as the review base / merge gate
 * - fail-closed TradingSafetyHold on order routes
 *
 * Pure filesystem reads; no network, no exchange, no secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * @param {string} root
 * @returns {{ ok: boolean, failures: string[], checks: { id: string, ok: boolean, detail: string }[] }}
 */
export function checkRepoPolicy(root = REPO_ROOT) {
  const checks = [];
  const failures = [];

  function mustContain(id, rel, needles) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) {
      const detail = `missing ${rel}`;
      checks.push({ id, ok: false, detail });
      failures.push(`${id}: ${detail}`);
      return;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    const missing = needles.filter((n) => !text.includes(n));
    if (missing.length) {
      const detail = `${rel} missing: ${missing.map(JSON.stringify).join(', ')}`;
      checks.push({ id, ok: false, detail });
      failures.push(`${id}: ${detail}`);
      return;
    }
    checks.push({ id, ok: true, detail: `${rel} encodes required policy markers` });
  }

  mustContain('agents-main-gate', 'AGENTS.md', [
    '`main` is the review base and merge gate',
    'TradingSafetyHold',
    'POST /api/orders',
  ]);

  mustContain('contributing-branch', 'CONTRIBUTING.md', [
    'Branch from `main`',
  ]);

  mustContain('execution-hold', 'docs/EXECUTION_SAFETY_HOLD.md', [
    'TradingSafetyHold',
    'POST /api/orders',
    'Re-enable gate',
  ]);

  mustContain('ci-workflow', '.github/workflows/ci.yml', [
    'branches: [main]',
    'Typecheck & build',
  ]);

  return { ok: failures.length === 0, failures, checks };
}

function main() {
  const result = checkRepoPolicy();
  for (const c of result.checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${c.id}: ${c.detail}`);
  }
  if (!result.ok) {
    console.error(`\nrepo-policy: ${result.failures.length} failure(s)`);
    process.exit(1);
  }
  console.log('\nrepo-policy: ok');
}

const invokedAsCli =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  main();
}
