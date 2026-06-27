import { describe, it, expect } from 'vitest';
import { computeStc, stcBoard, sortStc, type StcRow } from './stc';

// Small-period params let the whole EMA → MACD → stoch → smooth → stoch → smooth
// chain be computed exactly by hand. Verified independently by a 3-way
// adversarial recomputation: a strict uptrend [1..10] settles at 99.8046875.
const P = { fast: 2, slow: 3, cycle: 2, factor: 0.5 } as const;
const stc = (closes: number[]) => computeStc(closes, P.fast, P.slow, P.cycle, P.factor);

const ramp = (from: number, to: number) => {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v);
  return out;
};

describe('computeStc', () => {
  it('saturates near 100 on a strict uptrend (exact micro-example)', () => {
    // closes [1..10]: every stochastic pass reads 100 on a monotone rise, and
    // the 0.5 smoother halves the gap to 100 each bar → 99.8046875.
    const r = stc(ramp(1, 10))!;
    expect(r).not.toBeNull();
    expect(r.stc).toBeCloseTo(99.8046875, 7);
    expect(r.prev).toBeCloseTo(99.609375, 7);
    expect(r.dir).toBe('up');
    expect(r.zone).toBe('bull');
    expect(r.n).toBe(10);
  });

  it('pins to 0 on a strict downtrend', () => {
    // closes [10..1]: the current bar is always the window low → raw stochastic
    // 0 every bar → both smoothed stages stay exactly 0.
    const r = stc(ramp(10, 1))!;
    expect(r.stc).toBe(0);
    expect(r.prev).toBe(0);
    expect(r.zone).toBe('bear');
  });

  it('stays within [0, 100] on an oscillating series (default params)', () => {
    const wave = Array.from({ length: 160 }, (_, i) => 100 + 15 * Math.sin(i / 6) + 8 * Math.cos(i / 13));
    const r = computeStc(wave)!; // defaults 23/50/10/0.5
    expect(r).not.toBeNull();
    expect(r.stc).toBeGreaterThanOrEqual(0);
    expect(r.stc).toBeLessThanOrEqual(100);
  });

  it('reads a long ramp as a bull cycle (default params)', () => {
    const r = computeStc(ramp(10, 169))!; // 160 rising closes, defaults
    expect(r.stc).toBeGreaterThan(75);
    expect(r.zone).toBe('bull');
    expect(r.dir).toBe('up');
  });

  it('returns null below slow + 2·cycle closes', () => {
    expect(stc(ramp(1, 6))).toBeNull(); // 6 closes, needs slow+2·cycle = 7
    expect(computeStc(ramp(1, 60))).toBeNull(); // 60 closes, defaults need 70
    expect(computeStc([], 23, 50, 10)).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeStc(ramp(1, 10), 5, 3, 2)).toBeNull(); // slow ≤ fast
    expect(computeStc(ramp(1, 10), 2, 3, 1)).toBeNull(); // cycle < 2
    expect(computeStc(ramp(1, 10), 2, 3, 2, 0)).toBeNull(); // factor ≤ 0
    expect(computeStc(ramp(1, 10), 2, 3, 2, 1.5)).toBeNull(); // factor > 1
  });
});

describe('stcBoard / sortStc', () => {
  const up = ramp(1, 10);
  const down = ramp(10, 1);

  it('skips thin history and sorts by STC descending', () => {
    const board = stcBoard(
      [
        { symbol: 'DOWN', closes: down },
        { symbol: 'UP', closes: up },
        { symbol: 'THIN', closes: ramp(1, 5) },
      ],
      'stc',
      P.fast,
      P.slow,
      P.cycle,
      P.factor,
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
  });

  it('sorts by symbol name', () => {
    const rows: StcRow[] = [
      { symbol: 'UP', ...stc(up)! },
      { symbol: 'DOWN', ...stc(down)! },
    ];
    expect(sortStc(rows, 'symbol').map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('sorts by slope (rising cycles first)', () => {
    const rows: StcRow[] = [
      { symbol: 'DOWN', ...stc(down)! }, // slope 0
      { symbol: 'UP', ...stc(up)! }, // slope > 0
    ];
    expect(sortStc(rows, 'slope')[0].symbol).toBe('UP');
  });
});
