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

  function mustNotContain(id, rel, needles) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) {
      const detail = `missing ${rel}`;
      checks.push({ id, ok: false, detail });
      failures.push(`${id}: ${detail}`);
      return;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    const present = needles.filter((n) => text.includes(n));
    if (present.length) {
      const detail = `${rel} contains forbidden markers: ${present
        .map(JSON.stringify)
        .join(', ')}`;
      checks.push({ id, ok: false, detail });
      failures.push(`${id}: ${detail}`);
      return;
    }
    checks.push({ id, ok: true, detail: `${rel} excludes forbidden policy markers` });
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

  mustContain('opencode-workflow', '.github/workflows/opencode.yml', [
    "github.event.comment.author_association == 'OWNER'",
    "github.event.comment.author_association == 'MEMBER'",
    "github.event.comment.author_association == 'COLLABORATOR'",
    'group: opencode-${{ github.repository }}',
    'cancel-in-progress: true',
    'timeout-minutes: 30',
    'id-token: write',
    'contents: read',
    'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
    'persist-credentials: false',
    'releases/download/v1.18.4/opencode-linux-x64.tar.gz',
    'bab463c3fb3224d388bb7cfad63f38703df9cf0be2cfd2ce8cb49d886b53a174',
    "--proto-redir '=https'",
    '--max-time 300',
    'sha256sum --check --strict',
    'test -x "${install_dir}/opencode"',
    'test "${installed_version}" = "1.18.4"',
    'MODEL: opencode/claude-sonnet-4-6',
    'USE_GITHUB_TOKEN: "false"',
    'SHARE: "false"',
    'run: opencode github run',
  ]);

  mustNotContain('opencode-workflow-deny', '.github/workflows/opencode.yml', [
    'anomalyco/opencode/github@',
    'actions/cache@',
    'actions/checkout@v6',
    '@latest',
    'opencode.ai/install',
    'curl | bash',
    'USE_GITHUB_TOKEN: "true"',
    'SHARE: "true"',
    'contents: write',
    'issues:',
    'pull-requests:',
  ]);

  mustContain('opencode-operator-controls', 'docs/OPENCODE_WORKFLOW.md', [
    'provider-enforced hard budget/rate limit',
    'keep this workflow disabled',
    'SHARE: "false"',
    '49c69c5ed3ccf706b61b3febb43c8aaff7f8325e',
    '`unsigned`',
    'does **not** establish signed source provenance',
    'Forbidden regressions',
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
