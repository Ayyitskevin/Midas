import { describe, it, expect } from 'vitest';
import { computeGaps, gapBoard, sortGaps, type GapBar } from './gap';

// Three gaps: +2% (filled), −1.94% (filled), +2.857% (unfilled).
const BASIC: GapBar[] = [
  { open: 100, high: 105, low: 95, close: 100 },
  { open: 102, high: 104, low: 99, close: 103 },
  { open: 101, high: 106, low: 100, close: 105 },
  { open: 108, high: 110, low: 107, close: 109 },
];

// Single +10% gap-up that never trades back to the prior close → unfilled.
const GAPUP: GapBar[] = [
  { open: 100, high: 100, low: 100, close: 100 },
  { open: 110, high: 112, low: 108, close: 111 },
];

// Single −12% gap-down whose high tags the prior close → filled.
const GAPDOWN: GapBar[] = [
  { open: 100, high: 100, low: 100, close: 100 },
  { open: 88, high: 101, low: 87, close: 95 },
];

describe('computeGaps', () => {
  it('summarises a multi-gap history', () => {
    const r = computeGaps(BASIC)!;
    expect(r).not.toBeNull();
    expect(r.today).toBeCloseTo(2.8571, 3); // (108 − 105) / 105
    expect(r.up).toBe(2);
    expect(r.down).toBe(1);
    expect(r.gaps).toBe(3);
    expect(r.fillRate).toBeCloseTo(2 / 3, 6); // first two fill, the last does not
    expect(r.avgAbs).toBeCloseTo(2.2663, 3);
    expect(r.n).toBe(3);
  });

  it('marks an unfilled gap-up', () => {
    const r = computeGaps(GAPUP)!;
    expect(r.today).toBeCloseTo(10, 6);
    expect(r.up).toBe(1);
    expect(r.fillRate).toBe(0); // low 108 never reaches prior close 100
  });

  it('marks a filled gap-down', () => {
    const r = computeGaps(GAPDOWN)!;
    expect(r.today).toBeCloseTo(-12, 6);
    expect(r.down).toBe(1);
    expect(r.fillRate).toBe(1); // high 101 tags prior close 100
  });

  it('returns null below the minimum bars or with no usable transitions', () => {
    expect(computeGaps([])).toBeNull();
    expect(computeGaps([{ open: 100, high: 105, low: 95, close: 100 }])).toBeNull();
    expect(
      computeGaps([
        { open: 0, high: 0, low: 0, close: 0 },
        { open: 5, high: 6, low: 4, close: 5 },
      ]),
    ).toBeNull();
  });
});

describe('gapBoard', () => {
  const series = [
    { symbol: 'BASIC', bars: BASIC },
    { symbol: 'GAPUP', bars: GAPUP },
    { symbol: 'GAPDOWN', bars: GAPDOWN },
  ];

  it('defaults to sorting by absolute gap today, descending', () => {
    const rows = gapBoard(series);
    expect(rows.map((r) => r.symbol)).toEqual(['GAPDOWN', 'GAPUP', 'BASIC']); // |−12| > |10| > |2.86|
  });

  it('sorts by fill rate and by symbol', () => {
    const byFill = gapBoard(series, 'fillRate');
    expect(byFill[0].symbol).toBe('GAPDOWN'); // 100% filled
    expect(byFill[byFill.length - 1].symbol).toBe('GAPUP'); // 0% filled

    const bySym = gapBoard(series, 'symbol');
    expect(bySym.map((r) => r.symbol)).toEqual(['BASIC', 'GAPDOWN', 'GAPUP']);
  });

  it('skips symbols with too little history', () => {
    const rows = gapBoard([
      { symbol: 'OK', bars: BASIC },
      { symbol: 'THIN', bars: [{ open: 10, high: 11, low: 9, close: 10 }] },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortGaps', () => {
  it('orders by average absolute gap descending', () => {
    const rows = [
      { symbol: 'A', avgAbs: 1.1 },
      { symbol: 'B', avgAbs: 3.4 },
      { symbol: 'C', avgAbs: 0.2 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(sortGaps(rows, 'avgAbs').map((r: { symbol: string }) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
