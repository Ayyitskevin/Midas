import { describe, it, expect } from 'vitest';
import { computeTsi, tsiBoard, sortTsi, type TsiRow } from './tsi';

// Small-period params let the whole pc → EMA(long) → EMA(short) → ÷ → signal
// chain be computed exactly. Verified independently by a 2-way adversarial
// recomputation: closes [10,12,9,13,8] under long=2/short=2/signal=2 give
// TSI = −340/11 = −30.909091 and signal = −7.756636.
const P = { long: 2, short: 2, signal: 2 } as const;
const tsi = (closes: number[]) => computeTsi(closes, P.long, P.short, P.signal);

const ramp = (from: number, to: number) => {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v);
  return out;
};

describe('computeTsi', () => {
  it('matches the exact worked micro-example', () => {
    const r = tsi([10, 12, 9, 13, 8])!;
    expect(r).not.toBeNull();
    expect(r.tsi).toBeCloseTo(-30.909091, 5);
    expect(r.signal).toBeCloseTo(-7.756636, 5);
    expect(r.hist).toBeCloseTo(-23.152455, 5);
    expect(r.dir).toBe('down');
    expect(r.zone).toBe('os');
    expect(r.n).toBe(5);
  });

  it('reads a strict uptrend as +100 (all diffs +1)', () => {
    // Every price change is +1, so the signed and absolute double-smoothings are
    // identical and TSI = 100 · x / x = 100 exactly.
    const r = tsi(ramp(1, 6))!;
    expect(r.tsi).toBeCloseTo(100, 9);
    expect(r.zone).toBe('ob');
  });

  it('reads a strict downtrend as −100 (all diffs −1)', () => {
    const r = tsi(ramp(6, 1))!;
    expect(r.tsi).toBeCloseTo(-100, 9);
    expect(r.zone).toBe('os');
  });

  it('stays within [-100, 100] on an oscillating series (default params)', () => {
    const wave = Array.from({ length: 120 }, (_, i) => 100 + 12 * Math.sin(i / 5) + 5 * Math.cos(i / 11));
    const r = computeTsi(wave)!; // defaults 25/13/7
    expect(r).not.toBeNull();
    expect(r.tsi).toBeGreaterThanOrEqual(-100);
    expect(r.tsi).toBeLessThanOrEqual(100);
  });

  it('returns null below long + short + 1 closes', () => {
    expect(tsi(ramp(1, 4))).toBeNull(); // 4 closes, needs long+short+1 = 5
    expect(computeTsi(ramp(1, 30))).toBeNull(); // 30 closes, defaults need 39
    expect(computeTsi([], 25, 13, 7)).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeTsi(ramp(1, 10), 0, 2, 2)).toBeNull();
    expect(computeTsi(ramp(1, 10), 2, 0, 2)).toBeNull();
    expect(computeTsi(ramp(1, 10), 2, 2, 0)).toBeNull();
  });
});

describe('tsiBoard / sortTsi', () => {
  const up = ramp(1, 6);
  const down = ramp(6, 1);
  const mixed = [10, 12, 9, 13, 8];

  it('skips thin history and sorts by TSI descending', () => {
    const board = tsiBoard(
      [
        { symbol: 'DOWN', closes: down },
        { symbol: 'MIX', closes: mixed },
        { symbol: 'UP', closes: up },
        { symbol: 'THIN', closes: ramp(1, 4) },
      ],
      'tsi',
      P.long,
      P.short,
      P.signal,
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'MIX', 'DOWN']);
  });

  it('sorts by symbol name', () => {
    const rows: TsiRow[] = [
      { symbol: 'UP', ...tsi(up)! },
      { symbol: 'DOWN', ...tsi(down)! },
    ];
    expect(sortTsi(rows, 'symbol').map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('sorts by histogram (TSI above signal first)', () => {
    const rows: TsiRow[] = [
      { symbol: 'MIX', ...tsi(mixed)! }, // hist < 0
      { symbol: 'UP', ...tsi(up)! }, // hist 0
    ];
    expect(sortTsi(rows, 'hist')[0].symbol).toBe('UP');
  });
});
