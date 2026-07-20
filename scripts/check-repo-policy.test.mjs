import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRepoPolicy, REPO_ROOT } from './check-repo-policy.mjs';

test('live repository encodes main gate and trading safety hold', () => {
  const result = checkRepoPolicy(REPO_ROOT);
  assert.equal(result.ok, true, result.failures.join('; '));
  assert.ok(result.checks.every((c) => c.ok));
  assert.ok(result.checks.some((c) => c.id === 'agents-main-gate'));
  assert.ok(result.checks.some((c) => c.id === 'execution-hold'));
  assert.ok(result.checks.some((c) => c.id === 'ci-workflow'));
  assert.ok(result.checks.some((c) => c.id === 'opencode-workflow'));
  assert.ok(result.checks.some((c) => c.id === 'opencode-workflow-deny'));
  assert.ok(result.checks.some((c) => c.id === 'opencode-operator-controls'));
});

test('missing safety-hold language fails closed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midas-policy-'));
  try {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'no gate here\n');
    fs.writeFileSync(path.join(tmp, 'CONTRIBUTING.md'), 'Branch from `main`\n');
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs/EXECUTION_SAFETY_HOLD.md'), 'empty\n');
    fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github/workflows/ci.yml'),
      'on:\n  push:\n    branches: [main]\njobs:\n  build:\n    name: Typecheck & build\n',
    );
    const result = checkRepoPolicy(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes('agents-main-gate')));
    assert.ok(result.failures.some((f) => f.includes('execution-hold')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('moving, composite, shared, or overprivileged OpenCode paths fail closed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midas-opencode-policy-'));
  try {
    fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github/workflows/opencode.yml'),
      [
        'permissions:',
        '  contents: write',
        'steps:',
        '  - uses: actions/checkout@v6',
        '  - uses: actions/cache@v4',
        '  - uses: anomalyco/opencode/github@0123456789abcdef0123456789abcdef01234567',
        '  - run: curl https://opencode.ai/install | bash',
        '  - run: opencode@latest',
        '    env:',
        '      SHARE: "true"',
      ].join('\n'),
    );
    const result = checkRepoPolicy(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes('opencode-workflow:')));
    assert.ok(result.failures.some((f) => f.includes('opencode-workflow-deny:')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
