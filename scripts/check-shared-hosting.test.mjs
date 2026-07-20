import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  REPO_ROOT,
  checkSharedHosting,
  extractConfigEnvFlags,
  extractSharedHostingFlags,
} from './check-shared-hosting.mjs';

test('live SHARED_HOSTING checklist flags are all read by config.ts', async () => {
  const result = await checkSharedHosting(REPO_ROOT);
  assert.equal(result.ok, true, result.failures.join('; '));
  assert.ok(result.flags.includes('MIDAS_AUTH_ENABLED'));
  assert.ok(result.flags.includes('MIDAS_KEYS_KMS_SECRET'));
  assert.ok(result.flags.includes('MIDAS_TRADING_ENABLED'));
  const configFlags = extractConfigEnvFlags(
    fs.readFileSync(path.join(REPO_ROOT, 'apps/server/src/config.ts'), 'utf8'),
  );
  for (const f of result.flags) {
    assert.ok(configFlags.has(f), `config.ts must read ${f}`);
  }
});

test('extractSharedHostingFlags requires markers and returns unique MIDAS_* names', () => {
  const md = `
<!-- shared-hosting-flags:begin -->
| \`MIDAS_AUTH_ENABLED\` | x |
| MIDAS_KEYS_KMS_SECRET | y |
| \`MIDAS_AUTH_ENABLED\` | dup |
<!-- shared-hosting-flags:end -->
`;
  assert.deepEqual(extractSharedHostingFlags(md), [
    'MIDAS_AUTH_ENABLED',
    'MIDAS_KEYS_KMS_SECRET',
  ]);
  assert.throws(() => extractSharedHostingFlags('no markers'), /markers/);
});

test('checklist inventing unknown flag fails alignment', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midas-host-'));
  try {
    // Minimal skeleton: copy real hold sources, fake checklist with bogus flag.
    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/server/src/routes'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'docs/SHARED_HOSTING.md'),
      `# Shared\n<!-- shared-hosting-flags:begin -->\n| \`MIDAS_AUTH_ENABLED\` |\n| \`MIDAS_NOT_A_REAL_FLAG\` |\n| \`MIDAS_KEYS_KMS_SECRET\` |\n| \`MIDAS_MAX_KEYED_USERS\` |\n| \`MIDAS_RATE_LIMIT_RPM\` |\n| \`MIDAS_CORS_ORIGIN\` |\n| \`MIDAS_AUTH_SECRET\` |\n| \`MIDAS_DATA_PROVIDER\` |\n| \`MIDAS_TRADING_ENABLED\` |\n<!-- shared-hosting-flags:end -->\nfree and open source, no paid tier\n`,
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'docs/HOSTED_GO_LIVE.md'),
      path.join(tmp, 'docs/HOSTED_GO_LIVE.md'),
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'apps/server/src/config.ts'),
      path.join(tmp, 'apps/server/src/config.ts'),
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'apps/server/src/trading.ts'),
      path.join(tmp, 'apps/server/src/trading.ts'),
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'apps/server/src/routes/account.ts'),
      path.join(tmp, 'apps/server/src/routes/account.ts'),
    );
    const result = await checkSharedHosting(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes('MIDAS_NOT_A_REAL_FLAG')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
