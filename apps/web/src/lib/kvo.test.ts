import { describe, it, expect } from 'vitest';
import { computeKvo, kvoBoard, sortKvo, type KvoBar, type KvoRow } from './kvo';

const bar = (high: number, low: number, close: number, volume: number): KvoBar => ({ high, low, close, volume });

// Small periods let the trend → dm → cm → volume-force → EMA cascade be computed
// by hand. Verified by a 3-way adversarial recomputation against Klinger's
// published volume-force form |2·(dm/cm − 1)|: the 6 bars below under
// fast=2/slow=3/signal=2 give KVO = 2286.7284 and signal = 1040.9465.
const SIX = [
  bar(10, 8, 9, 100),
  bar(12, 9, 11, 150),
  bar(11, 9, 10, 120),
  bar(13, 10, 12, 200),
  bar(12, 10, 11, 130),
  bar(14, 11, 13, 180),
];

describe('computeKvo', () => {
  it('matches the exact worked micro-example', () => {
    const r = computeKvo(SIX, 2, 3, 2)!;
    expect(r).not.toBeNull();
    expect(r.kvo).toBeCloseTo(2286.7284, 3);
    expect(r.signal).toBeCloseTo(1040.9465, 3);
    expect(r.hist).toBeCloseTo(2286.7284 - 1040.9465, 3);
    expect(r.dir).toBe('up');
    expect(r.side).toBe('pos');
    expect(r.n).toBe(6);
  });

  it('normalises by average volume', () => {
    const r = computeKvo(SIX, 2, 3, 2)!;
    const avgVol = (100 + 150 + 120 + 200 + 130 + 180) / 6;
    expect(r.kvoNorm).toBeCloseTo(2286.7284 / avgVol, 4);
    expect(r.histNorm).toBeCloseTo(r.hist / avgVol, 6);
  });

  it('is exactly zero when every bar has no range', () => {
    // high == low → dm = 0 → cm = 0 → volume force 0 → KVO and signal 0.
    const flat = Array.from({ length: 6 }, () => bar(10, 10, 10, 100));
    const r = computeKvo(flat, 2, 3, 2)!;
    expect(r.kvo).toBe(0);
    expect(r.signal).toBe(0);
    expect(r.kvoNorm).toBe(0);
  });

  it('returns null below slow + signalPeriod bars', () => {
    expect(computeKvo(SIX.slice(0, 4), 2, 3, 2)).toBeNull(); // 4 bars, needs 5
    expect(computeKvo(SIX)).toBeNull(); // 6 bars, defaults need 68
    expect(computeKvo([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeKvo(SIX, 3, 3, 2)).toBeNull(); // fast >= slow
    expect(computeKvo(SIX, 2, 3, 0)).toBeNull(); // signal < 1
    expect(computeKvo(SIX, 0, 3, 2)).toBeNull(); // fast < 1
  });
});

describe('kvoBoard / sortKvo', () => {
  it('skips thin history and sorts by normalised KVO', () => {
    const board = kvoBoard(
      [
        { symbol: 'OK', bars: SIX },
        { symbol: 'THIN', bars: SIX.slice(0, 3) },
      ],
      'kvo',
      2,
      3,
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sorts by symbol and by histogram', () => {
    const a: KvoRow = { symbol: 'AAA', ...computeKvo(SIX, 2, 3, 2)! };
    const b: KvoRow = {
      symbol: 'BBB',
      ...computeKvo(SIX, 2, 3, 2)!,
      kvoNorm: -5,
      histNorm: -2,
    };
    expect(sortKvo([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortKvo([b, a], 'kvo')[0].symbol).toBe('AAA'); // higher kvoNorm first
    expect(sortKvo([b, a], 'hist')[0].symbol).toBe('AAA');
  });
});
