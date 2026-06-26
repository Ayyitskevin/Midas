import { describe, it, expect } from 'vitest';
import { trueRanges, computeRange, rangeBoard, sortRange, type RangeBar } from './range';

// Wide breakout day: three calm 2-wide days then a 6-wide expansion.
const WIDE: RangeBar[] = [
  { high: 10, low: 8, close: 9 },
  { high: 11, low: 9, close: 10 },
  { high: 12, low: 10, close: 11 },
  { high: 16, low: 10, close: 15 },
];

// NR day: three wide days then a tiny 1-wide inside day (the narrowest).
const NARROW: RangeBar[] = [
  { high: 20, low: 10, close: 15 },
  { high: 25, low: 12, close: 20 },
  { high: 24, low: 14, close: 18 },
  { high: 19, low: 18, close: 18.5 },
];

// Perfectly flat range: every true range is 2 → expansion exactly 1.
const FLAT: RangeBar[] = [
  { high: 10, low: 8, close: 9 },
  { high: 10, low: 8, close: 9 },
  { high: 10, low: 8, close: 9 },
];

describe('computeRange', () => {
  it('flags a wide-range expansion day', () => {
    const r = computeRange(WIDE)!;
    expect(r).not.toBeNull();
    expect(r.expansion).toBe(3); // today's TR 6 vs prior avg 2
    expect(r.rangePct).toBeCloseTo(40, 6); // 6 / 15 * 100
    expect(r.avgRangePct).toBeCloseTo(13.3333, 3); // 2 / 15 * 100
    expect(r.nrRank).toBe(4); // widest of the 4-bar window
    expect(r.isWide).toBe(true);
    expect(r.isNR).toBe(false);
    expect(r.n).toBe(4);
  });

  it('flags an NR (narrowest-range) day', () => {
    const r = computeRange(NARROW)!;
    expect(r.nrRank).toBe(1); // narrowest of the window
    expect(r.isNR).toBe(true);
    expect(r.isWide).toBe(false);
    expect(r.expansion).toBeCloseTo(1 / 11, 6); // TR 1 vs prior avg 11 → coiling
    expect(r.rangePct).toBeCloseTo(5.4054, 3); // 1 / 18.5 * 100
  });

  it('returns null below the minimum bar count or on a non-positive close', () => {
    expect(computeRange([])).toBeNull();
    expect(computeRange([{ high: 10, low: 8, close: 9 }])).toBeNull();
    expect(
      computeRange([
        { high: 10, low: 8, close: 9 },
        { high: 5, low: 3, close: 0 },
      ]),
    ).toBeNull();
  });
});

describe('trueRanges', () => {
  it('captures an overnight gap via the prev-close terms', () => {
    // Day 0 intrabar range is 1; day 1 gaps up so its true range is 10, not 2.
    const bars: RangeBar[] = [
      { high: 10, low: 9, close: 10 },
      { high: 20, low: 18, close: 19 },
    ];
    expect(trueRanges(bars)).toEqual([1, 10]);
    const r = computeRange(bars)!;
    expect(r.expansion).toBe(10); // TR 10 vs prior avg 1
    expect(r.rangePct).toBeCloseTo(52.6316, 3); // 10 / 19 * 100
    expect(r.isWide).toBe(true);
    expect(r.n).toBe(2);
  });
});

describe('rangeBoard', () => {
  const series = [
    { symbol: 'WIDE', bars: WIDE },
    { symbol: 'MID', bars: FLAT },
    { symbol: 'NARROW', bars: NARROW },
  ];

  it('defaults to sorting by expansion descending', () => {
    const rows = rangeBoard(series);
    expect(rows.map((r) => r.symbol)).toEqual(['WIDE', 'MID', 'NARROW']);
    // FLAT has equal ranges throughout → expansion exactly 1, neither flag.
    const mid = rows.find((r) => r.symbol === 'MID')!;
    expect(mid.expansion).toBe(1);
    expect(mid.isNR).toBe(false);
    expect(mid.isWide).toBe(false);
  });

  it('sorts by nrRank (narrowest first) and by symbol', () => {
    const byNr = rangeBoard(series, 'nrRank');
    expect(byNr[0].symbol).toBe('NARROW'); // rank 1, most compressed
    expect(byNr[byNr.length - 1].symbol).toBe('WIDE'); // rank 4

    const bySym = rangeBoard(series, 'symbol');
    expect(bySym.map((r) => r.symbol)).toEqual(['MID', 'NARROW', 'WIDE']);
  });

  it('skips symbols with too little history', () => {
    const rows = rangeBoard([
      { symbol: 'OK', bars: WIDE },
      { symbol: 'THIN', bars: [{ high: 10, low: 9, close: 9 }] },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortRange', () => {
  it('orders by rangePct descending', () => {
    const rows = [
      { symbol: 'A', rangePct: 5 },
      { symbol: 'B', rangePct: 12 },
      { symbol: 'C', rangePct: 8 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(sortRange(rows, 'rangePct').map((r: { symbol: string }) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
