import { describe, it, expect } from 'vitest';
import { computeCfo, cfoBoard, sortCfo, type CfoRow } from './cfo';

describe('computeCfo', () => {
  it('is 0 when price sits exactly on its regression line', () => {
    // perfectly linear closes → fit endpoint == close → CFO 0
    const r = computeCfo([10, 12, 14], 3)!;
    expect(r.fit).toBeCloseTo(14, 6);
    expect(r.cfo).toBeCloseTo(0, 6);
    expect(r.n).toBe(3);
  });

  it('is positive when the close runs above its fit', () => {
    // closes 10,12,15 → slope 2.5, intercept 9.8333, fit 14.8333; CFO = (15−14.8333)/15·100
    const r = computeCfo([10, 12, 15], 3)!;
    expect(r.fit).toBeCloseTo(29.5 / 3 + 5, 6); // 14.83333…
    expect(r.cfo).toBeCloseTo(((15 - (29.5 / 3 + 5)) / 15) * 100, 6);
    expect(r.side).toBe('up');
  });

  it('is negative when the close lags its fit', () => {
    // closes 10,12,13 → slope 1.5, intercept 10.1667, fit 13.1667; CFO < 0
    const r = computeCfo([10, 12, 13], 3)!;
    expect(r.fit).toBeCloseTo(30.5 / 3 + 3, 6); // 13.16667…
    expect(r.cfo).toBeCloseTo(((13 - (30.5 / 3 + 3)) / 13) * 100, 6);
    expect(r.side).toBe('down');
  });

  it('returns null with too little history', () => {
    expect(computeCfo([10, 12], 3)).toBeNull();
    expect(computeCfo([10], 2)).toBeNull();
    expect(computeCfo([], 2)).toBeNull();
  });
});

describe('cfoBoard', () => {
  const series = [
    { symbol: 'HIGH', closes: [10, 12, 15] }, // +CFO
    { symbol: 'LOW', closes: [10, 12, 13] }, // −CFO
  ];

  it('defaults to sorting by CFO descending', () => {
    const rows = cfoBoard(series, 'cfo', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
    expect(rows[0].side).toBe('up');
    expect(rows[1].side).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = cfoBoard(series, 'symbol', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
  });

  it('skips symbols with too little history', () => {
    const rows = cfoBoard(
      [
        { symbol: 'OK', closes: [10, 12, 15] },
        { symbol: 'THIN', closes: [10, 12] },
      ],
      'cfo',
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCfo', () => {
  it('orders by CFO descending', () => {
    const rows = [
      { symbol: 'A', cfo: 1 },
      { symbol: 'B', cfo: 4 },
      { symbol: 'C', cfo: -2 },
    ] as CfoRow[];
    expect(sortCfo(rows, 'cfo').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
