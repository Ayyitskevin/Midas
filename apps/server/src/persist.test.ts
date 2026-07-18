import { describe, it, expect, afterAll } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

  it('creates a NEW store owner-only (0o600), never world-readable at the umask default', () => {
    const f = join(dir, 'secret-store.json'); // holds encrypted keys / password hashes
    writeFileAtomic(f, '{"secret":true}');
    expect(statSync(f).mode & 0o077).toBe(0); // no group/other bits
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it('preserves the target file mode across writes (keeps an operator chmod 600)', () => {
    const f = join(dir, 'perms.json');
    writeFileAtomic(f, 'v1');
    chmodSync(f, 0o600); // operator tightens the credential store
    writeFileAtomic(f, 'v2'); // a fresh temp inode would otherwise land at umask default
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });
});
