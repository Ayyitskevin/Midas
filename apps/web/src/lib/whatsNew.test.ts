import { describe, it, expect } from 'vitest';
import { RELEASES, compareVersions, isNewerVersion } from './whatsNew';

describe('compareVersions', () => {
  it('orders semver-ish versions numerically, not lexically', () => {
    expect(compareVersions('0.3.0', '0.2.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.3.0')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0); // lexical would fail
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('0.3', '0.3.0')).toBe(0); // missing parts are zero
  });

  it('treats non-numeric parts as zero instead of crashing', () => {
    expect(compareVersions('abc', '0.0.0')).toBe(0);
    expect(compareVersions('0.3.0-beta', '0.3.0')).toBe(0);
  });
});

describe('isNewerVersion', () => {
  it('fires only on a genuine upgrade', () => {
    expect(isNewerVersion('0.3.0', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.2.0', '0.3.0')).toBe(false); // downgrade: stay quiet
  });

  it('baselines silently on first contact and with no server version', () => {
    expect(isNewerVersion('0.3.0', null)).toBe(false); // new user ≠ upgraded user
    expect(isNewerVersion('', '0.2.0')).toBe(false);
  });
});

describe('RELEASES data', () => {
  it('is non-empty, newest-first, with well-formed versions and highlights', () => {
    expect(RELEASES.length).toBeGreaterThanOrEqual(3);
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
      expect(r.highlights.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
    }
  });
});
