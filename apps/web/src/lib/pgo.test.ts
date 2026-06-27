import { describe, it, expect } from 'vitest';
import { computePgo, pgoBoard, sortPgo, type PgoBar, type PgoRow } from './pgo';

const bar = (high: number, low: number, close: number): PgoBar => ({ high, low, close });

describe('computePgo', () => {
  it('matches a hand-computed example', () => {
    // bars (h,l,c): (11,9,10) (13,10,12) (12,10,11) (14,11,13), N=3.
    //   TR = [2, 3, 2, 3];  EMA(TR,3) k=0.5 = [2, 2.5, 2.25, 2.625].
    //   last bar: SMA(close,3) = mean(12,11,13) = 12; (13 − 12) / 2.625 = 0.380952.
    //   prev bar: SMA(close,3) = mean(10,12,11) = 11; (11 − 11) / 2.25 = 0.
    const r = computePgo([bar(11, 9, 10), bar(13, 10, 12), bar(12, 10, 11), bar(14, 11, 13)], 3)!;
    expect(r).not.toBeNull();
    expect(r.pgo).toBeCloseTo(0.380952, 5);
    expect(r.prev).toBeCloseTo(0, 9);
    expect(r.dir).toBe('up');
    expect(r.side).toBe('pos');
    expect(r.zone).toBe('mid');
    expect(r.n).toBe(4);
  });

  it('is zero when price sits exactly on its mean', () => {
    // Symmetric oscillation around 100 so the latest close equals the SMA.
    const bars = [bar(101, 99, 100), bar(103, 101, 102), bar(99, 97, 98), bar(101, 99, 100)];
    const r = computePgo(bars, 3)!;
    // SMA(close,3) over [102,98,100] = 100, close = 100 → numerator 0.
    expect(r.pgo).toBeCloseTo(0, 9);
    expect(r.side).toBe('pos');
  });

  it('goes positive above the mean and negative below it', () => {
    const up = computePgo([bar(11, 9, 10), bar(12, 10, 11), bar(13, 11, 12), bar(20, 18, 19)], 3)!;
    expect(up.pgo).toBeGreaterThan(0);
    expect(up.side).toBe('pos');
    const down = computePgo([bar(20, 18, 19), bar(19, 17, 18), bar(18, 16, 17), bar(11, 9, 10)], 3)!;
    expect(down.pgo).toBeLessThan(0);
    expect(down.side).toBe('neg');
  });

  it('flags the ±3 stretch extremes', () => {
    // A steady ramp leaves the lagging SMA ~(N−1)/2 ATRs behind the latest
    // close, so a unit ramp with N=14 stretches PGO past +3.
    const ramp = Array.from({ length: 20 }, (_, i) => bar(100 + i + 0.5, 100 + i - 0.5, 100 + i));
    const r = computePgo(ramp, 14)!;
    expect(r.pgo).toBeGreaterThan(3);
    expect(r.zone).toBe('hi');
  });

  it('returns null below period bars', () => {
    expect(computePgo([bar(11, 9, 10), bar(13, 10, 12)], 3)).toBeNull(); // 2 bars, needs 3
    expect(computePgo([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computePgo([bar(11, 9, 10), bar(13, 10, 12), bar(12, 10, 11)], 0)).toBeNull();
  });
});

describe('pgoBoard / sortPgo', () => {
  const up = [bar(11, 9, 10), bar(12, 10, 11), bar(13, 11, 12), bar(20, 18, 19)];
  const down = [bar(20, 18, 19), bar(19, 17, 18), bar(18, 16, 17), bar(11, 9, 10)];

  it('skips thin history and sorts by PGO descending', () => {
    const board = pgoBoard(
      [
        { symbol: 'DOWN', bars: down },
        { symbol: 'UP', bars: up },
        { symbol: 'THIN', bars: up.slice(0, 2) },
      ],
      'pgo',
      3,
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
  });

  it('sorts by absolute stretch and by symbol', () => {
    const a: PgoRow = { symbol: 'AAA', ...computePgo(up, 3)!, pgo: 1 };
    const b: PgoRow = { symbol: 'BBB', ...computePgo(down, 3)!, pgo: -4 };
    expect(sortPgo([a, b], 'abs')[0].symbol).toBe('BBB'); // |−4| beats |1|
    expect(sortPgo([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
  });
});
