import { describe, it, expect } from 'vitest';
import {
  stochRsiSeries,
  computeStochRsi,
  stochRsiZone,
  stochRsiBoard,
  sortStochRsi,
  type StochRsiRow,
} from './stochRsi';

// Hand fixture: rsiPeriod=3, stochPeriod=3, smoothK=2, smoothD=2.
// Wilder RSI(3) over the closes alternates ≈ 83.33 / 66.67; the first raw
// Stoch-RSI = 100·(82.456 − 66.667)/(83.333 − 66.667) = 94.7368…; smoothed
// %K/%D converge toward ~50. Cross-checked by a scratch script.
const CLOSES = [10, 11, 10.5, 12, 11.5, 13, 12.5, 14, 13.5, 15, 14.5, 16, 15.5, 17, 16.5, 18];

describe('stochRsiSeries', () => {
  it('matches the hand-computed raw Stoch-RSI and smoothings', () => {
    const s = stochRsiSeries(CLOSES, 3, 3, 2, 2);
    expect(s.raw[0]).toBeCloseTo(94.73684210526316, 8);
    expect(s.k[s.k.length - 1]).toBeCloseTo(49.95617755280727, 8);
    expect(s.d[s.d.length - 1]).toBeCloseTo(49.92874527625329, 8);
  });

  it('stays within 0–100 on a noisy series', () => {
    const noisy = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 3) + (i % 5));
    const { k, d } = stochRsiSeries(noisy);
    for (const v of [...k, ...d]) {
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it('returns empty arrays with too little history', () => {
    expect(stochRsiSeries(CLOSES.slice(0, 6), 3, 3, 2, 2).k).toEqual([]);
  });
});

describe('computeStochRsi', () => {
  it('matches the hand-computed fixture', () => {
    const r = computeStochRsi(CLOSES, 3, 3, 2, 2)!;
    expect(r.k).toBeCloseTo(49.95617755280727, 8);
    expect(r.d).toBeCloseTo(49.92874527625329, 8);
    expect(r.zone).toBe('neutral');
    expect(r.n).toBe(16);
  });

  it('reads 0 on a pure monotonic trend (flat RSI ⇒ zero range)', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 100 - i);
    expect(computeStochRsi(up)!.k).toBe(0);
    expect(computeStochRsi(down)!.k).toBe(0);
  });

  it('returns null with bad params or too little history', () => {
    expect(computeStochRsi(CLOSES.slice(0, 6), 3, 3, 2, 2)).toBeNull();
    expect(computeStochRsi([], 14, 14, 3, 3)).toBeNull();
    expect(computeStochRsi(CLOSES, 0, 3, 2, 2)).toBeNull();
    expect(computeStochRsi(CLOSES, 3, 3, 0, 2)).toBeNull();
  });
});

describe('stochRsiZone', () => {
  it('classifies against the 80 / 20 guides', () => {
    expect(stochRsiZone(92)).toBe('overbought');
    expect(stochRsiZone(80)).toBe('overbought');
    expect(stochRsiZone(50)).toBe('neutral');
    expect(stochRsiZone(20)).toBe('oversold');
    expect(stochRsiZone(5)).toBe('oversold');
  });
});

describe('stochRsiBoard / sortStochRsi', () => {
  // A few deterministic, distinct close paths (long enough to fully warm up).
  const wave = (phase: number, amp: number): number[] =>
    Array.from({ length: 80 }, (_, i) => 100 + amp * Math.sin(i / 4 + phase));
  const series = [
    { symbol: 'AAA', closes: wave(0, 8) },
    { symbol: 'BBB', closes: wave(1.5, 8) },
    { symbol: 'CCC', closes: wave(3, 6) },
  ];

  it('sorts by %K descending by default', () => {
    const rows = stochRsiBoard(series, 'k');
    expect(rows).toHaveLength(3);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].k).toBeGreaterThanOrEqual(rows[i].k);
    }
  });

  it('sorts by symbol', () => {
    const rows = stochRsiBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('skips symbols with too little history', () => {
    const rows = stochRsiBoard(
      [
        { symbol: 'OK', closes: wave(0, 8) },
        { symbol: 'THIN', closes: wave(0, 8).slice(0, 20) },
      ],
      'k',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortStochRsi orders a plain row set by %K descending', () => {
    const rows = [
      { symbol: 'A', k: 12 },
      { symbol: 'B', k: 88 },
      { symbol: 'C', k: 47 },
    ] as StochRsiRow[];
    expect(sortStochRsi(rows, 'k').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
