import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import {
  classifyImpulse,
  computeImpulse,
  impulseBoard,
  sortImpulse,
  type ImpulseRow,
} from './impulse';

const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }));

describe('classifyImpulse', () => {
  it('is bull only when both slopes are strictly positive', () => {
    expect(classifyImpulse(1, 1)).toBe('bull');
    expect(classifyImpulse(0.001, 0.001)).toBe('bull');
  });

  it('is bear only when both slopes are strictly negative', () => {
    expect(classifyImpulse(-1, -1)).toBe('bear');
    expect(classifyImpulse(-0.001, -0.001)).toBe('bear');
  });

  it('is neutral when the slopes disagree', () => {
    expect(classifyImpulse(1, -1)).toBe('neutral');
    expect(classifyImpulse(-1, 1)).toBe('neutral');
  });

  it('is neutral when either slope is flat (strict comparison)', () => {
    expect(classifyImpulse(0, 5)).toBe('neutral');
    expect(classifyImpulse(5, 0)).toBe('neutral');
    expect(classifyImpulse(0, 0)).toBe('neutral');
  });
});

describe('computeImpulse', () => {
  // Worked micro-example, verified independently end-to-end:
  //   closes = [10, 10.5, 11.5, 13, 15, 17.5], reduced params emaP=2, MACD 2/3/2.
  //   ema       = [10, 10.3333, 11.1111, 12.3704, 14.1235, 16.3745]
  //   histogram = [0, 0.0655864, 0.0958076, 0.1104038]   (bars 2..5)
  //   emaSlopeLast = 16.3745 − 14.1235 = 2.2510288  (> 0, rising)
  //   histSlopeLast = 0.1104038 − 0.0958076 = 0.0145962  (> 0, rising)
  //   → both rising → bull.
  const example = mk([10, 10.5, 11.5, 13, 15, 17.5]);

  it('matches the hand-computed example (an accelerating uptrend is bull)', () => {
    const r = computeImpulse(example, 2, 2, 3, 2)!;
    expect(r).not.toBeNull();
    expect(r.impulse).toBe('bull');
    expect(r.prevImpulse).toBe('bull');
    expect(r.changed).toBe(false);
    expect(r.emaSlope).toBeCloseTo(2.2510288065843636, 9);
    expect(r.histSlope).toBeCloseTo(0.014596193415638215, 9);
    expect(r.hist).toBeCloseTo(0.11040380658436277, 9);
    expect(r.emaUp).toBe(true);
    expect(r.histUp).toBe(true);
  });

  it('keeps its derived fields self-consistent', () => {
    const r = computeImpulse(example, 2, 2, 3, 2)!;
    expect(r.emaUp).toBe(r.emaSlope > 0);
    expect(r.histUp).toBe(r.histSlope > 0);
    expect(r.changed).toBe(r.impulse !== r.prevImpulse);
    // histPct carries the histogram's sign; last close = 17.5.
    expect(r.histPct).toBeCloseTo((r.hist / 17.5) * 100, 9);
    expect(r.emaSlopePct).toBeCloseTo((r.emaSlope / 17.5) * 100, 9);
  });

  it('is bear when the EMA and histogram both fall (accelerating downtrend)', () => {
    const r = computeImpulse(mk([20, 19.5, 18.5, 17, 15, 12.5]), 2, 2, 3, 2)!;
    expect(r.impulse).toBe('bear');
    expect(r.emaUp).toBe(false);
    expect(r.histUp).toBe(false);
  });

  it('flips to neutral when momentum rolls over while the trend still rises', () => {
    // Strong accelerating up-move then a near-flat final bar: the 13-EMA still
    // rises but the histogram turns down → bull (prior) flips to neutral.
    const r = computeImpulse(mk([10, 11, 12.5, 14.5, 17, 17.1]), 2, 2, 3, 2)!;
    expect(r.impulse).toBe('neutral');
    expect(r.prevImpulse).toBe('bull');
    expect(r.changed).toBe(true);
    expect(r.emaUp).toBe(true); // trend intact
    expect(r.histUp).toBe(false); // momentum faded
  });

  it('returns a valid, self-consistent result with default params', () => {
    const r = computeImpulse(mk(Array.from({ length: 60 }, (_, i) => 100 + i * i * 0.05)))!;
    expect(r).not.toBeNull();
    expect(['bull', 'bear', 'neutral']).toContain(r.impulse);
    expect(r.changed).toBe(r.impulse !== r.prevImpulse);
    expect(r.n).toBe(60);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeImpulse([])).toBeNull();
    // Default slow=26 needs n ≥ 28 for three histogram bars.
    expect(computeImpulse(mk(Array.from({ length: 27 }, (_, i) => 100 + i)))).toBeNull();
    expect(computeImpulse(mk(Array.from({ length: 30 }, (_, i) => 100 + i)))).not.toBeNull();
    const long = mk(Array.from({ length: 40 }, (_, i) => 100 + i));
    expect(computeImpulse(long, 0)).toBeNull();
    expect(computeImpulse(long, 13, 12, 26, 0)).toBeNull();
  });
});

describe('impulseBoard / sortImpulse', () => {
  const rows: ImpulseRow[] = [
    { symbol: 'C/USDT', impulse: 'bear', prevImpulse: 'bear', changed: false, emaSlope: -1, emaUp: false, hist: -2, histSlope: -1, histUp: false, emaSlopePct: -1, histPct: -2, n: 60 },
    { symbol: 'A/USDT', impulse: 'bull', prevImpulse: 'neutral', changed: true, emaSlope: 1, emaUp: true, hist: 3, histSlope: 1, histUp: true, emaSlopePct: 1, histPct: 3, n: 60 },
    { symbol: 'B/USDT', impulse: 'neutral', prevImpulse: 'bull', changed: true, emaSlope: 1, emaUp: true, hist: 1, histSlope: -1, histUp: false, emaSlopePct: 1, histPct: 1, n: 60 },
  ];

  it('orders bull → neutral → bear by default', () => {
    const sorted = sortImpulse(rows, 'impulse');
    expect(sorted.map((r) => r.impulse)).toEqual(['bull', 'neutral', 'bear']);
  });

  it('sorts by histogram % and by symbol', () => {
    expect(sortImpulse(rows, 'histPct').map((r) => r.histPct)).toEqual([3, 1, -2]);
    expect(sortImpulse(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = impulseBoard([
      { symbol: 'OK/USDT', candles: mk(Array.from({ length: 40 }, (_, i) => 100 + i + (i % 3))) },
      { symbol: 'THIN/USDT', candles: mk([1, 2, 3]) },
    ]);
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
