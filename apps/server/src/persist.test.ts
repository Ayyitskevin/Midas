import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from './persist';

describe('writeFileAtomic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'midas-persist-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the file (and any missing parent dirs) with the exact contents', () => {
    const f = join(dir, 'nested', 'deep', 'store.json');
    writeFileAtomic(f, '{"a":1}');
    expect(readFileSync(f, 'utf8')).toBe('{"a":1}');
  });

  it('leaves no temp file behind on success', () => {
    const f = join(dir, 'clean.json');
    writeFileAtomic(f, 'hello');
    expect(existsSync(`${f}.tmp-${process.pid}`)).toBe(false);
  });

  it('replaces existing contents wholesale (never a truncated intermediate)', () => {
    const f = join(dir, 'replace.json');
    writeFileAtomic(f, 'v1-longer-original');
    writeFileAtomic(f, 'v2');
    expect(readFileSync(f, 'utf8')).toBe('v2');
  });
});
