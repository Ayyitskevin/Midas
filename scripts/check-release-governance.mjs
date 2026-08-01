#!/usr/bin/env node
/**
 * Release-governance policy checks — pure filesystem assertions.
 * No network. Fails CI-style (exit 1) when ship-path docs/workflows drift.
 *
 * Verifies:
 * 1. Branch governance docs claim `main` is the default / merge base.
 * 2. Ship-path files do not hard-code the historical feature-session branch
 *    as the default or merge base.
 * 3. OpenCode third-party action is pinned to a full commit SHA (not @latest).
 * 4. OpenCode + CI workflows declare concurrency groups.
 * 5. No workflow uses pull_request_target.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    failures.push(`missing file: ${rel}`);
    return '';
  }
  return readFileSync(p, 'utf8');
}

function mustInclude(rel, re, label) {
  const text = read(rel);
  if (!text) return;
  if (!re.test(text)) failures.push(`${rel}: expected ${label}`);
}

function mustNotMatch(rel, re, label) {
  const text = read(rel);
  if (!text) return;
  if (re.test(text)) failures.push(`${rel}: forbidden ${label}`);
}

// --- Branch governance honesty ---
mustInclude(
  'docs/BRANCH_GOVERNANCE.md',
  /GitHub default branch \|\s*`main`/i,
  'table row stating GitHub default branch is main',
);
mustInclude(
  'docs/BRANCH_GOVERNANCE.md',
  /reversible/i,
  'reversible operator plan language',
);
mustInclude(
  'AGENTS.md',
  /GitHub default branch/i,
  'AGENTS.md acknowledges main as GitHub default',
);
mustInclude(
  'AGENTS.md',
  /BRANCH_GOVERNANCE/,
  'AGENTS.md links BRANCH_GOVERNANCE',
);

// Ship-path must not treat modest-ride as default/merge base.
const shipPath = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  '.github/workflows/ci.yml',
  '.github/workflows/docs.yml',
  '.github/workflows/opencode.yml',
];
for (const rel of shipPath) {
  mustNotMatch(
    rel,
    /default branch[^\n]{0,80}claude\/modest-ride/i,
    'feature-session branch as default',
  );
  mustNotMatch(
    rel,
    /branches:\s*\[\s*['"]claude\/modest-ride/i,
    'CI filter on feature-session branch',
  );
}

// CI push filter must be main
mustInclude(
  '.github/workflows/ci.yml',
  /branches:\s*\[\s*main\s*\]/,
  'CI push branches: [main]',
);

// --- Workflow security ---
const opencode = read('.github/workflows/opencode.yml');
if (opencode) {
  if (/anomalyco\/opencode\/github@latest\b/.test(opencode)) {
    failures.push('opencode.yml: anomalyco/opencode/github must not use @latest');
  }
  // Full 40-char SHA pin
  if (!/anomalyco\/opencode\/github@[0-9a-f]{40}\b/.test(opencode)) {
    failures.push(
      'opencode.yml: pin anomalyco/opencode/github to a full 40-char commit SHA',
    );
  }
  if (!/^\s*concurrency:\s*$/m.test(opencode)) {
    failures.push('opencode.yml: missing concurrency group (cost/runaway control)');
  }
  if (!/permissions:\s*\n(?:\s+\w+:\s*\w+\s*\n)*\s*contents:\s*read/m.test(opencode)
    && !/contents:\s*read/.test(opencode)) {
    failures.push('opencode.yml: expected contents: read permission');
  }
  // Must not broaden to write on contents
  if (/contents:\s*write/.test(opencode)) {
    failures.push('opencode.yml: contents: write is not allowed for OpenCode');
  }
}

const ci = read('.github/workflows/ci.yml');
if (ci && !/^\s*concurrency:\s*$/m.test(ci)) {
  failures.push('ci.yml: missing concurrency group');
}

const workflowsDir = join(root, '.github/workflows');
if (existsSync(workflowsDir)) {
  for (const name of readdirSync(workflowsDir)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const text = readFileSync(join(workflowsDir, name), 'utf8');
    if (/pull_request_target/.test(text)) {
      failures.push(`${name}: pull_request_target is forbidden without a dedicated security review`);
    }
  }
}

// Dependency migration doc exists for deferred majors
mustInclude(
  'docs/DEPENDENCY_MIGRATION.md',
  /deferred/i,
  'deferred majors documentation',
);
mustInclude(
  'docs/WORKFLOW_SECURITY.md',
  /@latest|pinned/i,
  'workflow security pin discussion',
);

if (failures.length > 0) {
  console.error('check-release-governance: FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-release-governance: ok');
