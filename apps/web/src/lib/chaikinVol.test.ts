import { describe, it, expect } from 'vitest';
import {
  chaikinRangeEma,
  computeChaikinVol,
  chaikinVolBoard,
  sortChaikinVol,
  type ChaikinBar,
  type ChaikinVolRow,
} from './chaikinVol';

// Hand fixture: high−low ranges [2,4,3,5,4,6,5,7,6,8,7,9], emaPeriod=4, rocPeriod=4.
// EMA (k=2/5=0.4, first-value seed): 2 → 2.8 → 2.88 → 3.728 → … → 7.68818024448.
// CVOL = 100·(emaHL[11] − emaHL[7]) / emaHL[7] = 100·(7.68818… − 5.6927488)/5.6927488.
const RANGES = [2, 4, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9];
const bars: ChaikinBar[] = RANGES.map((r) => ({ high: 100 + r, low: 100 }));

describe('chaikinRangeEma', () => {
  it('EMAs the high−low range with first-value seeding', () => {
    const ema = chaikinRangeEma(bars, 4);
    expect(ema[0]).toBe(2);
    expect(ema[1]).toBeCloseTo(2.8, 12);
    expect(ema[3]).toBeCloseTo(3.728, 12);
    expect(ema[11]).toBeCloseTo(7.68818024448, 10);
  });
});

describe('computeChaikinVol', () => {
  it('matches the hand-computed fixture', () => {
    const r = computeChaikinVol(bars, 4, 4)!;
    expect(r.chaikinVol).toBeCloseTo(35.05216046912169, 10);
    expect(r.emaHL).toBeCloseTo(7.68818024448, 10);
    expect(r.regime).toBe('expanding');
    expect(r.n).toBe(12);
  });

  it('is scale-invariant — the same range shape at any price gives the same CVOL', () => {
    const scaled: ChaikinBar[] = RANGES.map((r) => ({ high: 50_000 + r * 1000, low: 50_000 }));
    expect(computeChaikinVol(scaled, 4, 4)!.chaikinVol).toBeCloseTo(35.05216046912169, 9);
  });

  it('reads 0 / flat on a constant range and negative / contracting on a shrinking range', () => {
    const flat: ChaikinBar[] = Array.from({ length: 10 }, () => ({ high: 5, low: 3 }));
    const fr = computeChaikinVol(flat, 4, 4)!;
    expect(fr.chaikinVol).toBe(0);
    expect(fr.regime).toBe('flat');

    const shrink: ChaikinBar[] = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1].map((r) => ({ high: r, low: 0 }));
    const sr = computeChaikinVol(shrink, 4, 4)!;
    expect(sr.chaikinVol).toBeLessThan(0);
    expect(sr.regime).toBe('contracting');
  });

  it('returns null with fewer than emaPeriod + rocPeriod bars or bad params', () => {
    expect(computeChaikinVol(bars.slice(0, 7), 4, 4)).toBeNull(); // need ≥ 8
    expect(computeChaikinVol([], 4, 4)).toBeNull();
    expect(computeChaikinVol(bars, 0, 4)).toBeNull();
    expect(computeChaikinVol(bars, 4, 0)).toBeNull();
  });
});

describe('chaikinVolBoard / sortChaikinVol', () => {
  const expand: ChaikinBar[] = [1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => ({ high: r, low: 0 }));
  const contract: ChaikinBar[] = [9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1].map((r) => ({ high: r, low: 0 }));
  const steady: ChaikinBar[] = Array.from({ length: 12 }, () => ({ high: 4, low: 1 }));
  const series = [
    { symbol: 'EXP', bars: expand },
    { symbol: 'CON', bars: contract },
    { symbol: 'STD', bars: steady },
  ];

  it('sorts by CVOL descending by default (fastest-expanding first)', () => {
    const rows = chaikinVolBoard(series, 'cvol', 4, 4);
    expect(rows[0].symbol).toBe('EXP');
    expect(rows[rows.length - 1].symbol).toBe('CON');
  });

  it('sorts by symbol', () => {
    const rows = chaikinVolBoard(series, 'symbol', 4, 4);
    expect(rows.map((r) => r.symbol)).toEqual(['CON', 'EXP', 'STD']);
  });

  it('skips symbols with too little history', () => {
    const rows = chaikinVolBoard(
      [
        { symbol: 'OK', bars: expand },
        { symbol: 'THIN', bars: expand.slice(0, 6) },
      ],
      'cvol',
      4,
      4,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortChaikinVol orders a plain row set by CVOL descending', () => {
    const rows = [
      { symbol: 'A', chaikinVol: -10 },
      { symbol: 'B', chaikinVol: 40 },
      { symbol: 'C', chaikinVol: 5 },
    ] as ChaikinVolRow[];
    expect(sortChaikinVol(rows, 'cvol').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
