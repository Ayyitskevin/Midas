import { describe, it, expect } from 'vitest';
import { computeHiLo, hiLoBoard, sortHiLo, type HiLoBar } from './highLow';

// Mid-range: last bar prints neither extreme. Hmax 120, Lmin 80, close 98.
const MID: HiLoBar[] = [
  { high: 120, low: 90, close: 100 },
  { high: 110, low: 80, close: 95 },
  { high: 105, low: 92, close: 98 },
];

// Fresh high: last bar prints the window high and closes near it.
const HIGH: HiLoBar[] = [
  { high: 100, low: 90, close: 95 },
  { high: 105, low: 92, close: 100 },
  { high: 130, low: 110, close: 128 },
];

// Fresh low: last bar prints the window low and closes near it.
const LOW: HiLoBar[] = [
  { high: 100, low: 90, close: 95 },
  { high: 98, low: 85, close: 88 },
  { high: 90, low: 70, close: 72 },
];

describe('computeHiLo', () => {
  it('places a mid-range close with no fresh flags', () => {
    const r = computeHiLo(MID)!;
    expect(r).not.toBeNull();
    expect(r.high).toBe(120);
    expect(r.low).toBe(80);
    expect(r.pos).toBeCloseTo(45, 6); // (98 − 80) / (120 − 80)
    expect(r.fromHigh).toBeCloseTo(-18.3333, 3); // 98 / 120 − 1
    expect(r.fromLow).toBeCloseTo(22.5, 6); // 98 / 80 − 1
    expect(r.freshHigh).toBe(false);
    expect(r.freshLow).toBe(false);
    expect(r.n).toBe(3);
  });

  it('flags a fresh window high', () => {
    const r = computeHiLo(HIGH)!;
    expect(r.freshHigh).toBe(true); // last bar's high 130 is the window max
    expect(r.freshLow).toBe(false);
    expect(r.pos).toBeCloseTo(95, 6); // (128 − 90) / (130 − 90)
    expect(r.fromHigh).toBeCloseTo(-1.5385, 3);
  });

  it('flags a fresh window low', () => {
    const r = computeHiLo(LOW)!;
    expect(r.freshLow).toBe(true); // last bar's low 70 is the window min
    expect(r.freshHigh).toBe(false);
    expect(r.pos).toBeCloseTo(6.6667, 3); // (72 − 70) / (100 − 70)
    expect(r.fromHigh).toBeCloseTo(-28, 6);
  });

  it('returns null with too little history, a flat range, or a non-positive low', () => {
    expect(computeHiLo([])).toBeNull();
    expect(computeHiLo([{ high: 100, low: 90, close: 95 }])).toBeNull();
    expect(
      computeHiLo([
        { high: 100, low: 100, close: 100 },
        { high: 100, low: 100, close: 100 },
      ]),
    ).toBeNull(); // Hmax == Lmin
    expect(
      computeHiLo([
        { high: 10, low: 0, close: 5 },
        { high: 10, low: 0, close: 5 },
      ]),
    ).toBeNull(); // low ≤ 0
  });

  it('honours the window argument, ignoring older extremes', () => {
    const bars: HiLoBar[] = [
      { high: 200, low: 10, close: 50 }, // outside a 2-bar window
      { high: 190, low: 20, close: 60 },
      { high: 180, low: 30, close: 70 },
      { high: 120, low: 95, close: 100 },
      { high: 130, low: 100, close: 110 },
    ];
    const r = computeHiLo(bars, 2)!;
    expect(r.high).toBe(130); // only the last two bars
    expect(r.low).toBe(95);
    expect(r.n).toBe(2);
    expect(r.pos).toBeCloseTo(42.857, 3); // (110 − 95) / (130 − 95)
  });
});

describe('hiLoBoard', () => {
  const series = [
    { symbol: 'MID', bars: MID },
    { symbol: 'HIGH', bars: HIGH },
    { symbol: 'LOW', bars: LOW },
  ];

  it('defaults to sorting by range position descending', () => {
    const rows = hiLoBoard(series);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'MID', 'LOW']); // pos 95 > 45 > 6.67
  });

  it('sorts by symbol', () => {
    const rows = hiLoBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW', 'MID']);
  });

  it('skips symbols with too little history', () => {
    const rows = hiLoBoard([
      { symbol: 'OK', bars: MID },
      { symbol: 'THIN', bars: [{ high: 10, low: 9, close: 10 }] },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortHiLo', () => {
  it('orders by fromHigh descending (closest to the high first)', () => {
    const rows = [
      { symbol: 'A', fromHigh: -20 },
      { symbol: 'B', fromHigh: -5 },
      { symbol: 'C', fromHigh: -30 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(sortHiLo(rows, 'fromHigh').map((r: { symbol: string }) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
