import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PORT, DEMO_PREFIX, parseArgs, resolveDemoPath, reviewerEnvironment } from './reviewer_demo.mjs';

test('reviewer arguments default to the safe static demo', () => {
  assert.deepEqual(parseArgs([]), { help: false, port: DEFAULT_PORT, build: true });
  assert.deepEqual(parseArgs(['--no-build', '--port=4317']), {
    help: false,
    port: 4317,
    build: false,
  });
  assert.throws(() => parseArgs(['--port', '0']), /between 1 and 65535/);
});

test('reviewer build environment removes Midas and credential-bearing values', () => {
  const env = reviewerEnvironment({
    HOME: '/tmp/reviewer',
    MIDAS_CCXT_SECRET: 'never-use',
    ANTHROPIC_API_KEY: 'never-use',
    AWS_SECRET_ACCESS_KEY: 'never-use',
    GITHUB_TOKEN: 'never-use',
    DATABASE_URL: 'postgres://never-use',
    VITE_MIDAS_STATIC_DEMO: 'false',
  });
  assert.equal(env.HOME, '/tmp/reviewer');
  assert.equal(env.VITE_MIDAS_STATIC_DEMO, 'true');
  assert.equal(env.MIDAS_CCXT_SECRET, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.DATABASE_URL, undefined);
});

test('demo path resolution stays under the build root', () => {
  const root = '/tmp/midas-demo';
  assert.equal(resolveDemoPath(root, `${DEMO_PREFIX}/assets/app.js`), `${root}/assets/app.js`);
  assert.equal(resolveDemoPath(root, '/not-the-demo'), null);
  assert.equal(resolveDemoPath(root, `${DEMO_PREFIX}/../../etc/passwd`), null);
  assert.equal(resolveDemoPath(root, `${DEMO_PREFIX}/%2e%2e/%2e%2e/etc/passwd`), null);
});
