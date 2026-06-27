import { describe, it, expect } from 'vitest';
import {
  computeWaveTrend,
  waveTrendBoard,
  sortWaveTrend,
  type WaveTrendBar,
  type WaveTrendRow,
} from './wavetrend';

const bar = (high: number, low: number, close: number): WaveTrendBar => ({ high, low, close });

// Small periods let the ap → esa → d → ci → EMA → SMA cascade be computed by
// hand. Verified by a 3-way adversarial recomputation against the LazyBear Pine:
// the 7 bars below under n1=2/n2=2/signal=2 give wt1 = 9.2562 and wt2 = 35.179.
const SEVEN = [
  bar(11, 9, 10),
  bar(13, 10, 12),
  bar(12, 10, 11),
  bar(14, 11, 13),
  bar(13, 11, 12),
  bar(15, 12, 14),
  bar(14, 12, 13),
];

describe('computeWaveTrend', () => {
  it('matches the exact worked micro-example', () => {
    const r = computeWaveTrend(SEVEN, 2, 2, 2)!;
    expect(r).not.toBeNull();
    expect(r.wt1).toBeCloseTo(9.2562, 3);
    expect(r.wt2).toBeCloseTo(35.179, 3);
    expect(r.hist).toBeCloseTo(9.2562 - 35.179, 3);
    expect(r.dir).toBe('down');
    expect(r.zone).toBe('mid');
    expect(r.n).toBe(7);
  });

  it('is zero when the typical price never moves', () => {
    // Constant ap → esa == ap → |ap−esa| = 0 → d = 0 → ci = 0 → wt1 = wt2 = 0.
    const flat = Array.from({ length: 7 }, () => bar(11, 9, 10)); // ap = 10 each
    const r = computeWaveTrend(flat, 2, 2, 2)!;
    expect(r.wt1).toBe(0);
    expect(r.wt2).toBe(0);
    expect(r.zone).toBe('mid');
  });

  it('keeps dir and hist consistent (wt1 below its signal reads down)', () => {
    const r = computeWaveTrend(SEVEN, 2, 2, 2)!;
    expect(r.hist).toBeCloseTo(r.wt1 - r.wt2, 9);
    expect(r.dir).toBe(r.wt1 >= r.wt2 ? 'up' : 'down');
    expect(r.dir).toBe('down'); // wt1 9.26 < wt2 35.18
  });

  it('returns null below n1 + n2 + signalPeriod bars', () => {
    expect(computeWaveTrend(SEVEN.slice(0, 5), 2, 2, 2)).toBeNull(); // 5 bars, needs 6
    expect(computeWaveTrend(SEVEN)).toBeNull(); // 7 bars, defaults need 35
    expect(computeWaveTrend([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeWaveTrend(SEVEN, 0, 2, 2)).toBeNull();
    expect(computeWaveTrend(SEVEN, 2, 0, 2)).toBeNull();
    expect(computeWaveTrend(SEVEN, 2, 2, 0)).toBeNull();
  });
});

describe('waveTrendBoard / sortWaveTrend', () => {
  it('skips thin history and keeps computable symbols', () => {
    const board = waveTrendBoard(
      [
        { symbol: 'OK', bars: SEVEN },
        { symbol: 'THIN', bars: SEVEN.slice(0, 4) },
      ],
      'wt',
      2,
      2,
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sorts by wt1, symbol, and histogram', () => {
    const a: WaveTrendRow = { symbol: 'AAA', ...computeWaveTrend(SEVEN, 2, 2, 2)!, wt1: 40, hist: 5 };
    const b: WaveTrendRow = { symbol: 'BBB', ...computeWaveTrend(SEVEN, 2, 2, 2)!, wt1: -10, hist: -3 };
    expect(sortWaveTrend([b, a], 'wt')[0].symbol).toBe('AAA');
    expect(sortWaveTrend([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortWaveTrend([b, a], 'hist')[0].symbol).toBe('AAA');
  });
});
