import { describe, it, expect } from 'vitest';
import { computeRvgi, rvgiBoard, sortRvgi, type RvgiBar, type RvgiRow } from './rvgi';

const bar = (open: number, high: number, low: number, close: number): RvgiBar => ({ open, high, low, close });

// Small N lets the 1·2·2·1 filter → SMA ratio → 1·2·2·1 signal chain be computed
// by hand. Verified by a 3-way adversarial recomputation against Ehlers' original:
// the 8 bars below under N=2 give RVI = 0.238095 and signal = 0.268429.
const SIX = [
  bar(10, 11, 9, 10.5),
  bar(10.5, 12, 10, 11.5),
  bar(11.5, 12.5, 11, 12),
  bar(12, 13, 11.5, 12.8),
  bar(12.8, 13.5, 12, 12.5),
  bar(12.5, 13, 11.8, 12.9),
  bar(12.9, 14, 12.5, 13.6),
  bar(13.6, 14.5, 13, 14),
];

const rep = (b: RvgiBar, n = 8) => Array.from({ length: n }, () => ({ ...b }));

describe('computeRvgi', () => {
  it('matches the exact worked micro-example', () => {
    const r = computeRvgi(SIX, 2)!;
    expect(r).not.toBeNull();
    expect(r.rvi).toBeCloseTo(0.238095, 5);
    expect(r.signal).toBeCloseTo(0.268429, 5);
    expect(r.hist).toBeCloseTo(0.238095 - 0.268429, 5);
    expect(r.dir).toBe('down');
    expect(r.side).toBe('pos');
    expect(r.n).toBe(8);
  });

  it('reads bars that close at their high as +1 vigor', () => {
    // open == low, close == high → co == hl → every ratio is 1.
    const r = computeRvgi(rep(bar(10, 12, 10, 12)), 2)!;
    expect(r.rvi).toBeCloseTo(1, 9);
    expect(r.signal).toBeCloseTo(1, 9);
    expect(r.side).toBe('pos');
  });

  it('reads bars that close at their low as −1 vigor', () => {
    // open == high, close == low → co == −hl → every ratio is −1.
    const r = computeRvgi(rep(bar(12, 12, 10, 10)), 2)!;
    expect(r.rvi).toBeCloseTo(-1, 9);
    expect(r.side).toBe('neg');
  });

  it('is zero when every bar closes where it opened', () => {
    // doji: close == open → numerator 0, denominator non-zero → RVI 0.
    const r = computeRvgi(rep(bar(10, 11, 9, 10)), 2)!;
    expect(r.rvi).toBe(0);
    expect(r.signal).toBe(0);
  });

  it('returns null below N + 6 bars', () => {
    expect(computeRvgi(SIX.slice(0, 7), 2)).toBeNull(); // 7 bars, needs 8
    expect(computeRvgi(SIX)).toBeNull(); // 8 bars, default N=10 needs 16
    expect(computeRvgi([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeRvgi(SIX, 0)).toBeNull();
  });
});

describe('rvgiBoard / sortRvgi', () => {
  it('skips thin history and sorts by RVI descending', () => {
    const board = rvgiBoard(
      [
        { symbol: 'BEAR', bars: rep(bar(12, 12, 10, 10)) }, // rvi -1
        { symbol: 'BULL', bars: rep(bar(10, 12, 10, 12)) }, // rvi +1
        { symbol: 'THIN', bars: SIX.slice(0, 5) },
      ],
      'rvi',
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['BULL', 'BEAR']);
  });

  it('sorts by symbol and by histogram', () => {
    const a: RvgiRow = { symbol: 'AAA', ...computeRvgi(SIX, 2)!, hist: 0.5 };
    const b: RvgiRow = { symbol: 'BBB', ...computeRvgi(SIX, 2)!, hist: -0.5 };
    expect(sortRvgi([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortRvgi([b, a], 'hist')[0].symbol).toBe('AAA');
  });
});
