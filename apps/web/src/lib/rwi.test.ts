import { describe, it, expect } from 'vitest';
import { computeRwi, rwiBoard, sortRwi, type RwiBar, type RwiRow } from './rwi';

const bar = (high: number, low: number, close: number): RwiBar => ({ high, low, close });

const SQRT2 = Math.SQRT2; // ≈ 1.4142135623730951

describe('computeRwi', () => {
  it('reads a clean up-trend as +√2 (period 2)', () => {
    // TR: [2, 3, 3]; k=2 → ATR=3, denom=3·√2.
    // RWIhigh = (14 − 8)/(3√2) = 6/(3√2) = √2.
    // RWIlow  = (10 − 11)/(3√2) = −1/(3√2) ≈ −0.235702.
    const bars = [bar(10, 8, 9), bar(12, 9, 11), bar(14, 11, 13)];
    const r = computeRwi(bars, 2)!;
    expect(r).not.toBeNull();
    expect(r.rwiHigh).toBeCloseTo(SQRT2, 6);
    expect(r.rwiLow).toBeCloseTo(-1 / (3 * SQRT2), 6);
    expect(r.rwi).toBeCloseTo(SQRT2, 6);
    expect(r.dir).toBe('up');
    expect(r.trending).toBe(true);
    expect(r.n).toBe(3);
  });

  it('reads a clean down-trend as −√2 (period 2)', () => {
    // TR: [3, 4, 2]; k=2 → ATR=3, denom=3·√2.
    // RWIhigh = (10 − 11)/(3√2) = −1/(3√2) ≈ −0.235702.
    // RWIlow  = (14 − 8)/(3√2) = 6/(3√2) = √2.
    const bars = [bar(14, 11, 13), bar(12, 9, 10), bar(10, 8, 9)];
    const r = computeRwi(bars, 2)!;
    expect(r.rwiHigh).toBeCloseTo(-1 / (3 * SQRT2), 6);
    expect(r.rwiLow).toBeCloseTo(SQRT2, 6);
    expect(r.rwi).toBeCloseTo(-SQRT2, 6);
    expect(r.dir).toBe('down');
    expect(r.trending).toBe(true);
  });

  it('reads a flat, choppy range as sub-1 noise (period 2)', () => {
    // Identical bars: TR=20 each; k=2 → ATR=20, denom=20·√2.
    // RWIhigh = RWIlow = 20/(20√2) = 1/√2 ≈ 0.707107 — below the trend threshold.
    const bars = [bar(20, 0, 10), bar(20, 0, 10), bar(20, 0, 10)];
    const r = computeRwi(bars, 2)!;
    expect(r.rwiHigh).toBeCloseTo(1 / SQRT2, 6);
    expect(r.rwiLow).toBeCloseTo(1 / SQRT2, 6);
    expect(r.rwi).toBeCloseTo(1 / SQRT2, 6);
    expect(r.dir).toBe('up'); // tie resolves to the up side
    expect(r.trending).toBe(false);
  });

  it('takes the max ratio across look-backs (period 3)', () => {
    // Bars 0..3, last=3. TR: [2,3,3,3].
    // k=2: ATR=(tr2+tr3)/2=3, denom=3√2; hi=(h3−l1)/denom=(16−9)/3√2=7/(3√2)≈1.6499.
    // k=3: ATR=(tr1+tr2+tr3)/3=3, denom=3√3; hi=(h3−l0)/denom=(16−8)/3√3=8/(3√3)≈1.5396.
    // Max RWIhigh = k=2 branch ≈ 1.6499.
    const bars = [bar(10, 8, 9), bar(12, 9, 11), bar(14, 11, 13), bar(16, 13, 15)];
    const r = computeRwi(bars, 3)!;
    expect(r.rwiHigh).toBeCloseTo(7 / (3 * SQRT2), 6);
    expect(r.dir).toBe('up');
    expect(r.trending).toBe(true);
  });

  it('returns null below period + 1 bars', () => {
    expect(computeRwi([bar(10, 8, 9), bar(12, 9, 11)], 2)).toBeNull(); // only 2 bars, need 3
    expect(computeRwi([], 14)).toBeNull();
    expect(computeRwi([bar(10, 8, 9), bar(12, 9, 11), bar(14, 11, 13)], 1)).toBeNull(); // period < 2
  });

  it('returns null when the whole window is flat (no ATR)', () => {
    const bars = [bar(5, 5, 5), bar(5, 5, 5), bar(5, 5, 5)];
    expect(computeRwi(bars, 2)).toBeNull();
  });
});

describe('rwiBoard / sortRwi', () => {
  const up = [bar(10, 8, 9), bar(12, 9, 11), bar(14, 11, 13)];
  const down = [bar(14, 11, 13), bar(12, 9, 10), bar(10, 8, 9)];
  const noise = [bar(20, 0, 10), bar(20, 0, 10), bar(20, 0, 10)];

  it('skips thin history and sorts by signed rwi descending', () => {
    const board = rwiBoard(
      [
        { symbol: 'UP', bars: up },
        { symbol: 'DOWN', bars: down },
        { symbol: 'NOISE', bars: noise },
        { symbol: 'THIN', bars: [bar(1, 0, 1)] },
      ],
      'rwi',
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'NOISE', 'DOWN']);
  });

  it('sorts by trend strength regardless of direction', () => {
    const rows: RwiRow[] = [
      { symbol: 'UP', ...computeRwi(up, 2)! },
      { symbol: 'DOWN', ...computeRwi(down, 2)! },
      { symbol: 'NOISE', ...computeRwi(noise, 2)! },
    ];
    // UP and DOWN both have strength √2; NOISE 1/√2 sits last.
    expect(sortRwi(rows, 'trend').at(-1)!.symbol).toBe('NOISE');
  });

  it('sorts by symbol name', () => {
    const rows: RwiRow[] = [
      { symbol: 'UP', ...computeRwi(up, 2)! },
      { symbol: 'DOWN', ...computeRwi(down, 2)! },
    ];
    expect(sortRwi(rows, 'symbol').map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });
});
