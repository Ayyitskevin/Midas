/**
 * Unit tests for release-governance policy checker.
 * Drives the real script against the real repo tree (no mocks of policy text).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/check-release-governance.mjs');

function runChecker() {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('check-release-governance', () => {
  it('passes on the current repository ship-path policy', () => {
    const r = runChecker();
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /ok/);
  });

  it('requires a full SHA pin for the OpenCode action in the shipped workflow', () => {
    const yml = readFileSync(join(root, '.github/workflows/opencode.yml'), 'utf8');
    assert.doesNotMatch(yml, /anomalyco\/opencode\/github@latest\b/);
    assert.match(yml, /anomalyco\/opencode\/github@[0-9a-f]{40}\b/);
  });

  it('documents main as the GitHub default branch in BRANCH_GOVERNANCE', () => {
    const doc = readFileSync(join(root, 'docs/BRANCH_GOVERNANCE.md'), 'utf8');
    assert.match(doc, /GitHub default branch \|\s*`main`/i);
    assert.match(doc, /reversible/i);
  });

  it('classifies deferred major dependency upgrades', () => {
    const doc = readFileSync(join(root, 'docs/DEPENDENCY_MIGRATION.md'), 'utf8');
    assert.match(doc, /vite/i);
    assert.match(doc, /lightweight-charts/i);
    assert.match(doc, /@fastify\/cors|fastify\/cors/i);
    assert.match(doc, /deferred/i);
  });
});
