import { describe, it, expect } from 'vitest';
import { computeCmo, cmoBoard, cmoZone, sortCmo, type CmoRow } from './cmo';

describe('cmoZone', () => {
  it('classifies on the ±50 thresholds (inclusive)', () => {
    expect(cmoZone(80)).toBe('overbought');
    expect(cmoZone(50)).toBe('overbought');
    expect(cmoZone(0)).toBe('neutral');
    expect(cmoZone(-50)).toBe('oversold');
    expect(cmoZone(-80)).toBe('oversold');
  });
});

describe('computeCmo', () => {
  it('is +100 on a pure uptrend and −100 on a pure downtrend', () => {
    expect(computeCmo([1, 2, 3, 4], 3)).toBe(100); // changes +1,+1,+1
    expect(computeCmo([4, 3, 2, 1], 3)).toBe(-100); // changes −1,−1,−1
  });

  it('nets up vs down moves over their total', () => {
    // closes 10,11,10,12 → changes +1,−1,+2 → up=3, down=1 → (3−1)/4·100 = 50
    expect(computeCmo([10, 11, 10, 12], 3)).toBeCloseTo(50, 6);
    // closes 10,11,10,10.5 → changes +1,−1,+0.5 → up=1.5, down=1 → 0.5/2.5·100 = 20
    expect(computeCmo([10, 11, 10, 10.5], 3)).toBeCloseTo(20, 6);
  });

  it('maps a flat (no movement) window to 0', () => {
    expect(computeCmo([5, 5, 5, 5], 3)).toBe(0);
  });

  it('returns null with too little history', () => {
    expect(computeCmo([1, 2, 3], 3)).toBeNull(); // needs period + 1 closes
    expect(computeCmo([], 3)).toBeNull();
  });
});

describe('cmoBoard', () => {
  const series = [
    { symbol: 'UP', closes: [1, 2, 3, 4] }, // +100
    { symbol: 'DOWN', closes: [4, 3, 2, 1] }, // −100
  ];

  it('defaults to sorting by CMO descending', () => {
    const rows = cmoBoard(series, 'cmo', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].zone).toBe('overbought');
    expect(rows[1].zone).toBe('oversold');
  });

  it('sorts by symbol', () => {
    const rows = cmoBoard(series, 'symbol', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = cmoBoard(
      [
        { symbol: 'OK', closes: [1, 2, 3, 4] },
        { symbol: 'THIN', closes: [1, 2] },
      ],
      'cmo',
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCmo', () => {
  it('orders by CMO descending', () => {
    const rows = [
      { symbol: 'A', cmo: 20 },
      { symbol: 'B', cmo: 70 },
      { symbol: 'C', cmo: -40 },
    ] as CmoRow[];
    expect(sortCmo(rows, 'cmo').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
