import { describe, expect, it } from 'vitest';
import { fmtAgeShort, freshnessView } from './freshness';

describe('fmtAgeShort', () => {
  it('renders short age text by magnitude', () => {
    expect(fmtAgeShort(0)).toBe('now');
    expect(fmtAgeShort(9_999)).toBe('now');
    expect(fmtAgeShort(12_000)).toBe('12s');
    expect(fmtAgeShort(59_000)).toBe('59s');
    expect(fmtAgeShort(3 * 60_000)).toBe('3m');
    expect(fmtAgeShort(2 * 3_600_000)).toBe('2h');
    expect(fmtAgeShort(5 * 86_400_000)).toBe('5d');
  });

  it('clamps negative ages (clock skew) to now', () => {
    expect(fmtAgeShort(-5_000)).toBe('now');
  });
});

describe('freshnessView', () => {
  const now = 1_000_000;

  it('renders nothing when there was never an update', () => {
    expect(freshnessView({ fetchedAt: null, staleAfterMs: 10_000, now })).toEqual({
      text: null,
      stale: false,
    });
  });

  it('is fresh within the threshold', () => {
    expect(freshnessView({ fetchedAt: now - 8_000, staleAfterMs: 10_000, now })).toEqual({
      text: 'now',
      stale: false,
    });
  });

  it('turns stale once the age passes the threshold', () => {
    const v = freshnessView({ fetchedAt: now - 11_000, staleAfterMs: 10_000, now });
    expect(v.text).toBe('11s');
    expect(v.stale).toBe(true);
  });

  it('turns stale on a disconnected stream even when the data is recent', () => {
    const v = freshnessView({
      fetchedAt: now - 1_000,
      staleAfterMs: 30_000,
      streamDisconnected: true,
      now,
    });
    expect(v.stale).toBe(true);
  });

  it('stays fresh on a connected stream', () => {
    const v = freshnessView({
      fetchedAt: now - 1_000,
      staleAfterMs: 30_000,
      streamDisconnected: false,
      now,
    });
    expect(v.stale).toBe(false);
  });
});
