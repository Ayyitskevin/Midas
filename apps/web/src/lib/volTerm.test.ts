import { describe, it, expect } from 'vitest';
import { realizedVol, volTermStructure, termShape, volTerm } from '@/lib/volTerm';

// Alternating ±a returns → population std = a.
const alt = (a: number, n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? -a : a));

describe('realizedVol', () => {
  it('annualizes the std by √periods', () => {
    expect(realizedVol(alt(0.01, 20), 365)).toBeCloseTo(0.01 * Math.sqrt(365), 9);
  });
});

describe('volTermStructure', () => {
  it('measures each lookback whose full window is available', () => {
    const pts = volTermStructure(alt(0.01, 40), [7, 30, 200], 365);
    expect(pts.map((p) => p.lookbackDays)).toEqual([7, 30]); // 200 > 40 returns → dropped
    expect(pts[0].n).toBe(7);
  });

  it('drops a lookback when there are fewer returns than the window', () => {
    expect(volTermStructure(alt(0.01, 5), [7], 365)).toEqual([]); // 5 < 7
    expect(volTermStructure(alt(0.01, 10), [7], 365)).toHaveLength(1); // 10 ≥ 7
  });
});

describe('termShape', () => {
  it('flags elevated near-term vol when the short end is hotter', () => {
    // calm history, hot last 7
    const returns = [...alt(0.005, 100), ...alt(0.05, 7)];
    const t = volTerm(returns, [7, 30, 90], 365);
    expect(t.points).toHaveLength(3);
    expect(t.shortVol! > t.longVol!).toBe(true);
    expect(t.ratio!).toBeGreaterThan(1.05);
    expect(t.regime).toBe('elevated');
  });

  it('flags compressed near-term vol when the short end is calmer', () => {
    const returns = [...alt(0.05, 100), ...alt(0.005, 7)];
    const t = volTerm(returns, [7, 30, 90], 365);
    expect(t.ratio!).toBeLessThan(0.95);
    expect(t.regime).toBe('compressed');
  });

  it('is flat for a uniform-vol series and empty-safe', () => {
    // even-length windows ⇒ each slice has mean 0 and std exactly 0.01
    const t = volTerm(alt(0.01, 120), [10, 30, 90], 365);
    expect(t.regime).toBe('flat');
    expect(t.ratio!).toBeCloseTo(1, 6);
    expect(termShape([])).toMatchObject({ regime: 'flat', shortVol: null, ratio: null });
  });
});
