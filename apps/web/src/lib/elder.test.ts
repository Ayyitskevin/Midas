import { describe, it, expect } from 'vitest';
import { computeElder, elderBoard, sortElder, type ElderBar, type ElderRow } from './elder';

const bar = (high: number, low: number, close: number): ElderBar => ({ high, low, close });

// EMA(period 2) is recursive with k=2/3, first-value seed (shared emaSeries):
//   closes [10,12,14] → EMA = [10, 34/3, 118/9]; latest EMA = 118/9 ≈ 13.1111
//   bull = 15 − 118/9 = 17/9 ≈ 1.8889; bear = 13 − 118/9 = −1/9 ≈ −0.1111
const uptrend: ElderBar[] = [bar(10, 9, 10), bar(12, 11, 12), bar(15, 13, 14)];
//   closes [14,12,10] → EMA = [14, 38/3, 98/9]; latest EMA = 98/9 ≈ 10.8889 (falling → down)
//   bull = 11 − 98/9 = 1/9 ≈ 0.1111; bear = 9 − 98/9 = −17/9 ≈ −1.8889
const downtrend: ElderBar[] = [bar(14, 13, 14), bar(13, 11, 12), bar(11, 9, 10)];

describe('computeElder', () => {
  it('reads positive bull power in an up-trend', () => {
    const r = computeElder(uptrend, 2)!;
    expect(r.trend).toBe('up');
    expect(r.bull).toBeCloseTo(17 / 9, 6);
    expect(r.bear).toBeCloseTo(-1 / 9, 6);
    expect(r.bullPct).toBeCloseTo((17 / 118) * 100, 6); // (17/9)/(118/9)·100
    expect(r.bearPct).toBeCloseTo((-1 / 118) * 100, 6);
    expect(r.n).toBe(3);
  });

  it('reads a falling EMA as a down-trend with deep bear power', () => {
    const r = computeElder(downtrend, 2)!;
    expect(r.trend).toBe('down');
    expect(r.bull).toBeCloseTo(1 / 9, 6);
    expect(r.bear).toBeCloseTo(-17 / 9, 6);
  });

  it('returns null with too little history', () => {
    expect(computeElder([bar(10, 9, 10), bar(12, 11, 12)], 2)).toBeNull(); // n < period + 1
    expect(computeElder([], 2)).toBeNull();
  });
});

describe('elderBoard', () => {
  const series = [
    { symbol: 'UP', bars: uptrend },
    { symbol: 'DOWN', bars: downtrend },
  ];

  it('defaults to sorting by bull power descending', () => {
    const rows = elderBoard(series, 'bull', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']); // 14.4% vs ~1.0%
    expect(rows[0].trend).toBe('up');
    expect(rows[1].trend).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = elderBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = elderBoard(
      [
        { symbol: 'OK', bars: uptrend },
        { symbol: 'THIN', bars: [bar(10, 9, 10), bar(12, 11, 12)] },
      ],
      'bull',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortElder', () => {
  it('orders by bear power descending (least bearish first)', () => {
    const rows = [
      { symbol: 'A', bearPct: -3 },
      { symbol: 'B', bearPct: -0.5 },
      { symbol: 'C', bearPct: -8 },
    ] as ElderRow[];
    expect(sortElder(rows, 'bear').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
