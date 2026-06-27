import { describe, it, expect } from 'vitest';
import { computeSmi, smiBoard, sortSmi, type SmiBar, type SmiRow } from './smi';

const bar = (high: number, low: number, close: number): SmiBar => ({ high, low, close });

// Small periods let the midrange → double-EMA → 200·ds/dhl → signal cascade be
// computed by hand. Verified by a 3-way adversarial recomputation against the
// TradingView SMI: the 8 bars below under lengthK=2/smooth=2,2/signal=2 give
// SMI = 24.173 and signal = 19.1035.
const EIGHT = [
  bar(11, 9, 10),
  bar(13, 10, 12),
  bar(12, 10, 11),
  bar(14, 11, 13),
  bar(13, 11, 12),
  bar(15, 12, 14),
  bar(14, 12, 13),
  bar(16, 13, 15),
];

describe('computeSmi', () => {
  it('matches the exact worked micro-example', () => {
    const r = computeSmi(EIGHT, 2, 2, 2, 2)!;
    expect(r).not.toBeNull();
    expect(r.smi).toBeCloseTo(24.173, 2);
    expect(r.signal).toBeCloseTo(19.1035, 2);
    expect(r.hist).toBeCloseTo(24.173 - 19.1035, 2);
    expect(r.dir).toBe('up');
    expect(r.zone).toBe('mid');
    expect(r.n).toBe(8);
  });

  it('is zero when the range collapses', () => {
    // high == low → hlRange = 0 → dhl = 0 → SMI guarded to 0.
    const flat = Array.from({ length: 10 }, () => bar(10, 10, 10));
    const r = computeSmi(flat, 2, 2, 2, 2)!;
    expect(r.smi).toBe(0);
    expect(r.signal).toBe(0);
    expect(r.zone).toBe('mid');
  });

  it('pushes overbought when close rides the high of the range', () => {
    // Rising bars with close == high → distance from midpoint ≈ +half-range → SMI → +100.
    const rising = Array.from({ length: 12 }, (_, i) => bar(10 + i, 8 + i, 10 + i));
    const r = computeSmi(rising, 2, 2, 2, 2)!;
    expect(r.smi).toBeGreaterThan(40);
    expect(r.zone).toBe('ob');
  });

  it('pushes oversold when close rides the low of the range', () => {
    // Falling bars with close == low → distance ≈ −half-range → SMI → −100.
    const falling = Array.from({ length: 12 }, (_, i) => bar(20 - i, 18 - i, 18 - i));
    const r = computeSmi(falling, 2, 2, 2, 2)!;
    expect(r.smi).toBeLessThan(-40);
    expect(r.zone).toBe('os');
  });

  it('returns null below lengthK + smooth1 + smooth2 + signalPeriod bars', () => {
    expect(computeSmi(EIGHT.slice(0, 7), 2, 2, 2, 2)).toBeNull(); // 7 bars, needs 8
    expect(computeSmi(EIGHT)).toBeNull(); // 8 bars, defaults need 19
    expect(computeSmi([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeSmi(EIGHT, 0, 2, 2, 2)).toBeNull();
    expect(computeSmi(EIGHT, 2, 2, 2, 0)).toBeNull();
  });
});

describe('smiBoard / sortSmi', () => {
  const rising = Array.from({ length: 12 }, (_, i) => bar(10 + i, 8 + i, 10 + i));
  const falling = Array.from({ length: 12 }, (_, i) => bar(20 - i, 18 - i, 18 - i));

  it('skips thin history and sorts by SMI descending', () => {
    const board = smiBoard(
      [
        { symbol: 'DOWN', bars: falling },
        { symbol: 'UP', bars: rising },
        { symbol: 'THIN', bars: EIGHT.slice(0, 5) },
      ],
      'smi',
      2,
      2,
      2,
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
  });

  it('sorts by symbol and by histogram', () => {
    const a: SmiRow = { symbol: 'AAA', ...computeSmi(rising, 2, 2, 2, 2)!, hist: 5 };
    const b: SmiRow = { symbol: 'BBB', ...computeSmi(falling, 2, 2, 2, 2)!, hist: -5 };
    expect(sortSmi([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortSmi([b, a], 'hist')[0].symbol).toBe('AAA');
  });
});
