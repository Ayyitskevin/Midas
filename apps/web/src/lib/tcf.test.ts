import { describe, it, expect } from 'vitest';
import { computeTcf, tcfBoard, sortTcf, type TcfRow } from './tcf';

// Primary fixture — independently verified by a multi-agent workflow (M.H. Pee's
// published TCF confirmed vs the MetaStock TASC port + 3 ports; reference impl +
// two adversarial recomputations agreed to machine precision). Raw-change form
// gives +5 / −11; the shipped percent-return form gives the values below.
// closes rise 100→109 with two pullbacks → +TCF > 0 (uptrend), −TCF far below 0.
const up = [100, 102, 103, 101, 104, 106, 105, 108, 110, 109];
// Mirror-ish decline → −TCF > 0 (downtrend).
const down = [109, 110, 108, 105, 106, 104, 101, 103, 102, 100];
// Strong down-run then strong up-run inside the window → both factors ≤ 0 (range).
const range = [100, 97, 93, 88, 92, 97, 103];

describe('computeTcf', () => {
  it('reads a clean uptrend (+TCF > 0, −TCF far below 0)', () => {
    const r = computeTcf(up, 5)!;
    expect(r.trendPlus).toBeCloseTo(4.779584, 5);
    expect(r.trendMinus).toBeCloseTo(-10.607024, 5);
    expect(r.regime).toBe('up');
    expect(r.n).toBe(10);
  });

  it('reads a downtrend (−TCF > 0)', () => {
    const r = computeTcf(down, 5)!;
    expect(r.trendPlus).toBeCloseTo(-8.580534, 5);
    expect(r.trendMinus).toBeCloseTo(5.722868, 5);
    expect(r.regime).toBe('down');
  });

  it('flags consolidation when both factors are ≤ 0', () => {
    const r = computeTcf(range, 6)!;
    expect(r.trendPlus).toBeCloseTo(-6.457963, 5);
    expect(r.trendMinus).toBeCloseTo(-18.19144, 4);
    expect(r.trendPlus).toBeLessThanOrEqual(0);
    expect(r.trendMinus).toBeLessThanOrEqual(0);
    expect(r.regime).toBe('range');
  });

  it('returns null with fewer than length + 1 closes', () => {
    expect(computeTcf(up.slice(0, 5), 5)).toBeNull();
    expect(computeTcf([], 5)).toBeNull();
  });

  it('rejects a non-positive length', () => {
    expect(computeTcf(up, 0)).toBeNull();
  });
});

describe('tcfBoard', () => {
  const series = [
    { symbol: 'UP', closes: up }, // +TCF ≈ +4.78
    { symbol: 'DOWN', closes: down }, // +TCF ≈ −8.58, −TCF ≈ +5.72
    { symbol: 'RANGE', closes: [...range, 103] }, // pad to 8 so length 5 has a full window
  ];

  it('defaults to sorting by +TCF descending (most bullish first)', () => {
    const rows = tcfBoard(series, 'plus', 5);
    expect(rows[0].symbol).toBe('UP');
    expect(rows[rows.length - 1].symbol).toBe('DOWN');
  });

  it('sorts by −TCF descending (strongest downtrends first)', () => {
    const rows = tcfBoard(series, 'minus', 5);
    expect(rows[0].symbol).toBe('DOWN');
  });

  it('sorts by symbol', () => {
    const rows = tcfBoard(series, 'symbol', 5);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'RANGE', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = tcfBoard(
      [
        { symbol: 'OK', closes: up },
        { symbol: 'THIN', closes: up.slice(0, 5) },
      ],
      'plus',
      5,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortTcf', () => {
  it('orders by +TCF descending', () => {
    const rows = [
      { symbol: 'A', trendPlus: 0.3, trendMinus: -1 },
      { symbol: 'B', trendPlus: 1.2, trendMinus: -2 },
      { symbol: 'C', trendPlus: -0.5, trendMinus: 0.4 },
    ] as TcfRow[];
    expect(sortTcf(rows, 'plus').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
