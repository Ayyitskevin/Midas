import { describe, it, expect } from 'vitest';
import { computeForce, forceBoard, sortForce, type ForceBar, type ForceRow } from './forceIndex';

const bar = (close: number, volume: number): ForceBar => ({ close, volume });

// EMA(period 2) is recursive with k=2/3, first-value seed (shared emaSeries).
// Rising prices on volume → bullish Force Index:
//   raw = [(110−100)·10, (121−110)·10] = [100, 110]
//   FI  = ema([100,110],2) = [100, (2·110+100)/3 = 320/3 ≈ 106.667]
//   avgVol(last 2) = 10, close = 121 → forcePct = (320/3)/(121·10)·100 ≈ 8.8154
const up: ForceBar[] = [bar(100, 10), bar(110, 10), bar(121, 10)];
// Falling prices → bearish: raw = [−110, −100]; FI = [−110, −310/3 ≈ −103.333]
const down: ForceBar[] = [bar(121, 10), bar(110, 10), bar(100, 10)];

describe('computeForce', () => {
  it('is positive (bulls) when price rises on volume', () => {
    const r = computeForce(up, 2)!;
    expect(r.force).toBeCloseTo(320 / 3, 5);
    expect(r.forcePct).toBeCloseTo(((320 / 3) / (121 * 10)) * 100, 5);
    expect(r.side).toBe('bulls');
    expect(r.rising).toBe(true);
    expect(r.n).toBe(3);
  });

  it('is negative (bears) when price falls on volume', () => {
    const r = computeForce(down, 2)!;
    expect(r.force).toBeCloseTo(-310 / 3, 5);
    expect(r.side).toBe('bears');
  });

  it('returns null with too little history', () => {
    expect(computeForce([bar(100, 10), bar(110, 10)], 2)).toBeNull(); // n < period + 1
    expect(computeForce([], 2)).toBeNull();
  });
});

describe('forceBoard', () => {
  const series = [
    { symbol: 'UP', bars: up }, // +8.8%
    { symbol: 'DOWN', bars: down }, // −8.5%
  ];

  it('defaults to sorting by normalized force descending', () => {
    const rows = forceBoard(series, 'force', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].side).toBe('bulls');
    expect(rows[1].side).toBe('bears');
  });

  it('sorts by symbol', () => {
    const rows = forceBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = forceBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: [bar(100, 10), bar(110, 10)] },
      ],
      'force',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortForce', () => {
  it('orders by normalized force descending', () => {
    const rows = [
      { symbol: 'A', forcePct: 2 },
      { symbol: 'B', forcePct: 9 },
      { symbol: 'C', forcePct: -4 },
    ] as ForceRow[];
    expect(sortForce(rows, 'force').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
