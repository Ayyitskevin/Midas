import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { computeRmi, rmiBoard, sortRmi, type RmiRow } from './rmi';
import { rsi } from './indicators';

// Verified by a 3-way adversarial recomputation against Altman's original:
// closes below under length=3 / momentum=2 give RMI = 56.701.
const MIX = [100, 102, 101, 99, 103, 98, 104, 97, 105];

const candle = (close: number, i: number): Candle => ({
  time: i,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
});

describe('computeRmi', () => {
  it('matches the exact worked micro-example', () => {
    const r = computeRmi(MIX, 3, 2)!;
    expect(r).not.toBeNull();
    expect(r.rmi).toBeCloseTo(56.701, 2);
    expect(r.prev).toBeCloseTo(40, 2);
    expect(r.dir).toBe('up');
    expect(r.zone).toBe('mid');
    expect(r.n).toBe(9);
  });

  it('reduces exactly to a Wilder RSI when momentum = 1', () => {
    const closes = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108];
    const period = 5;
    const rmi = computeRmi(closes, period, 1)!;
    const rsiSeries = rsi(closes.map(candle), period);
    const lastRsi = rsiSeries[rsiSeries.length - 1].value;
    expect(rmi.rmi).toBeCloseTo(lastRsi, 6);
  });

  it('reads a relentless up-momentum as 100', () => {
    const rising = Array.from({ length: 12 }, (_, i) => 100 + i); // every M-bar change > 0
    const r = computeRmi(rising, 3, 2)!;
    expect(r.rmi).toBeCloseTo(100, 9);
    expect(r.zone).toBe('ob');
  });

  it('reads a relentless down-momentum as 0', () => {
    const falling = Array.from({ length: 12 }, (_, i) => 100 - i);
    const r = computeRmi(falling, 3, 2)!;
    expect(r.rmi).toBeCloseTo(0, 9);
    expect(r.zone).toBe('os');
  });

  it('reads a flat series (no momentum) as a neutral 50', () => {
    const flat = Array.from({ length: 12 }, () => 100);
    const r = computeRmi(flat, 3, 2)!;
    expect(r.rmi).toBe(50);
    expect(r.zone).toBe('mid');
  });

  it('returns null below momentum + length closes', () => {
    expect(computeRmi(MIX.slice(0, 4), 3, 2)).toBeNull(); // 4 closes, needs 5
    expect(computeRmi([100, 101, 102], 20, 5)).toBeNull(); // defaults need 25
    expect(computeRmi([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeRmi(MIX, 0, 2)).toBeNull();
    expect(computeRmi(MIX, 3, 0)).toBeNull();
  });
});

describe('rmiBoard / sortRmi', () => {
  const rising = Array.from({ length: 12 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 12 }, (_, i) => 100 - i);

  it('skips thin history and sorts by RMI descending', () => {
    const board = rmiBoard(
      [
        { symbol: 'DOWN', closes: falling },
        { symbol: 'UP', closes: rising },
        { symbol: 'THIN', closes: MIX.slice(0, 4) },
      ],
      'rmi',
      3,
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
  });

  it('sorts by symbol and by slope', () => {
    const a: RmiRow = { symbol: 'AAA', ...computeRmi(rising, 3, 2)!, rmi: 60, prev: 50 };
    const b: RmiRow = { symbol: 'BBB', ...computeRmi(falling, 3, 2)!, rmi: 40, prev: 45 };
    expect(sortRmi([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortRmi([b, a], 'slope')[0].symbol).toBe('AAA'); // +10 slope beats −5
  });
});
