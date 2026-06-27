import { describe, it, expect } from 'vitest';
import { computeCrsi, crsiBoard, sortCrsi, type CrsiRow } from './crsi';

// Small rankPeriod lets the whole 3-component composite be computed by hand.
// Verified by a 3-way adversarial recomputation against the Stock.Indicators
// reference: closes below under (3,2,4) give CRSI = 68.712458 with components
// RSI(close,3)=82.4, RSI(streak,2)=73.737374, percentRank=50.
const P = { rsi: 3, streak: 2, rank: 4 } as const;
const crsi = (closes: number[]) => computeCrsi(closes, P.rsi, P.streak, P.rank);

const ramp = (from: number, to: number) => {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v);
  return out;
};

describe('computeCrsi', () => {
  it('matches the exact worked micro-example, component by component', () => {
    const r = crsi([100, 102, 101, 103, 104, 102, 105, 107])!;
    expect(r).not.toBeNull();
    expect(r.rsiClose).toBeCloseTo(82.4, 4);
    expect(r.rsiStreak).toBeCloseTo(73.737374, 4);
    expect(r.pctRank).toBeCloseTo(50, 6);
    expect(r.crsi).toBeCloseTo(68.712458, 4);
    expect(r.zone).toBe('mid');
    expect(r.n).toBe(8);
  });

  it('drives both RSI components to 100 on a strict uptrend', () => {
    // All-up closes: no losses → both Wilder RSIs = 100; ROC shrinks as the base
    // grows so the latest return is the smallest → percentRank 0.
    const r = crsi(ramp(1, 8))!;
    expect(r.rsiClose).toBeCloseTo(100, 9);
    expect(r.rsiStreak).toBeCloseTo(100, 9);
    expect(r.pctRank).toBeCloseTo(0, 9);
    expect(r.crsi).toBeCloseTo((100 + 100 + 0) / 3, 6);
  });

  it('pins to 0 on a strict downtrend', () => {
    const r = crsi(ramp(8, 1))!;
    expect(r.rsiClose).toBeCloseTo(0, 9);
    expect(r.rsiStreak).toBeCloseTo(0, 9);
    expect(r.crsi).toBeCloseTo(0, 9);
    expect(r.zone).toBe('os');
  });

  it('stays within [0, 100] on an oscillating series (default params)', () => {
    const wave = Array.from({ length: 160 }, (_, i) => 100 + 10 * Math.sin(i / 4) + 4 * Math.cos(i / 9));
    const r = computeCrsi(wave)!; // defaults 3/2/100
    expect(r).not.toBeNull();
    expect(r.crsi).toBeGreaterThanOrEqual(0);
    expect(r.crsi).toBeLessThanOrEqual(100);
  });

  it('returns null below rankPeriod + 2 closes', () => {
    expect(crsi(ramp(1, 5))).toBeNull(); // 5 closes, needs rank+2 = 6
    expect(computeCrsi(ramp(1, 80))).toBeNull(); // 80 closes, defaults need 102
    expect(computeCrsi([], 3, 2, 100)).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeCrsi(ramp(1, 10), 0, 2, 4)).toBeNull();
    expect(computeCrsi(ramp(1, 10), 3, 0, 4)).toBeNull();
    expect(computeCrsi(ramp(1, 10), 3, 2, 0)).toBeNull();
  });
});

describe('crsiBoard / sortCrsi', () => {
  const up = ramp(1, 8); // crsi ≈ 66.67
  const down = ramp(8, 1); // crsi = 0
  const mixed = [100, 102, 101, 103, 104, 102, 105, 107]; // crsi ≈ 68.71

  it('skips thin history and sorts by CRSI descending', () => {
    const board = crsiBoard(
      [
        { symbol: 'DOWN', closes: down },
        { symbol: 'MIX', closes: mixed },
        { symbol: 'UP', closes: up },
        { symbol: 'THIN', closes: ramp(1, 5) },
      ],
      'crsi',
      P.rsi,
      P.streak,
      P.rank,
    );
    expect(board.map((r) => r.symbol)).toEqual(['MIX', 'UP', 'DOWN']);
  });

  it('sorts by symbol name', () => {
    const rows: CrsiRow[] = [
      { symbol: 'UP', ...crsi(up)! },
      { symbol: 'DOWN', ...crsi(down)! },
    ];
    expect(sortCrsi(rows, 'symbol').map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });
});
