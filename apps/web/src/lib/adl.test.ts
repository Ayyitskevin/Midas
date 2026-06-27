import { describe, it, expect } from 'vitest';
import { computeAdl, adlBoard, moneyFlowMultiplier, sortAdl, type AdlBar, type AdlRow } from './adl';

const bar = (high: number, low: number, close: number, volume: number): AdlBar => ({ high, low, close, volume });

describe('moneyFlowMultiplier', () => {
  it('is +1 when the close is at the high, −1 at the low, 0 mid / no range', () => {
    expect(moneyFlowMultiplier(bar(10, 8, 10, 100))).toBe(1);
    expect(moneyFlowMultiplier(bar(10, 8, 8, 100))).toBe(-1);
    expect(moneyFlowMultiplier(bar(10, 8, 9, 100))).toBe(0);
    expect(moneyFlowMultiplier(bar(10, 10, 10, 100))).toBe(0); // zero range
  });
});

describe('computeAdl', () => {
  it('rises with accumulation (close at the highs) and flags a new A/D high', () => {
    // Each bar MFM=+1, MFV=+100 → ADL = 100, 200, 300
    const r = computeAdl([bar(10, 8, 10, 100), bar(12, 10, 12, 100), bar(14, 12, 14, 100)], 2)!;
    expect(r.adl).toBe(300);
    expect(r.flowPct).toBeCloseTo(100, 6); // (300−100)/(100+100)·100
    expect(r.trend).toBe('up');
    expect(r.extreme).toBe('high');
    expect(r.n).toBe(3);
  });

  it('falls with distribution (close at the lows) and flags a new A/D low', () => {
    // Each bar MFM=−1 → ADL = −100, −200, −300
    const r = computeAdl([bar(10, 8, 8, 100), bar(12, 10, 10, 100), bar(14, 12, 12, 100)], 2)!;
    expect(r.adl).toBe(-300);
    expect(r.flowPct).toBeCloseTo(-100, 6);
    expect(r.trend).toBe('down');
    expect(r.extreme).toBe('low');
  });

  it('is flat with mid-range closes (no net flow, no new extreme)', () => {
    const r = computeAdl([bar(10, 8, 9, 100), bar(12, 8, 10, 100), bar(12, 8, 10, 100)], 2)!;
    expect(r.adl).toBe(0);
    expect(r.flowPct).toBe(0);
    expect(r.extreme).toBe('none');
  });

  it('returns null with too little history', () => {
    expect(computeAdl([bar(10, 8, 10, 100), bar(12, 10, 12, 100)], 2)).toBeNull(); // n < period + 1
    expect(computeAdl([], 2)).toBeNull();
  });
});

describe('adlBoard', () => {
  const series = [
    { symbol: 'ACC', bars: [bar(10, 8, 10, 100), bar(12, 10, 12, 100), bar(14, 12, 14, 100)] }, // +100%
    { symbol: 'DIST', bars: [bar(10, 8, 8, 100), bar(12, 10, 10, 100), bar(14, 12, 12, 100)] }, // −100%
  ];

  it('defaults to sorting by flow% descending', () => {
    const rows = adlBoard(series, 'flow', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['ACC', 'DIST']);
    expect(rows[0].extreme).toBe('high');
    expect(rows[1].extreme).toBe('low');
  });

  it('sorts by symbol', () => {
    const rows = adlBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['ACC', 'DIST']);
  });

  it('skips symbols with too little history', () => {
    const rows = adlBoard(
      [
        { symbol: 'OK', bars: [bar(10, 8, 10, 100), bar(12, 10, 12, 100), bar(14, 12, 14, 100)] },
        { symbol: 'THIN', bars: [bar(10, 8, 10, 100), bar(12, 10, 12, 100)] },
      ],
      'flow',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortAdl', () => {
  it('orders by flow% descending', () => {
    const rows = [
      { symbol: 'A', flowPct: 20 },
      { symbol: 'B', flowPct: 60 },
      { symbol: 'C', flowPct: -30 },
    ] as AdlRow[];
    expect(sortAdl(rows, 'flow').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
