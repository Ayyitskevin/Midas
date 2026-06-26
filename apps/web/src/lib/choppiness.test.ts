import { describe, it, expect } from 'vitest';
import { computeChop, chopRegime, chopBoard, sortChop, type ChopBar } from './choppiness';

// Pure trend: price marches straight up, each bar's range tiles the span with
// no overlap → Σ TR == span → CHOP 0. (period 4, window = last 4 bars)
const TREND: ChopBar[] = [
  { high: 10, low: 8, close: 10 },
  { high: 12, low: 10, close: 12 },
  { high: 14, low: 12, close: 14 },
  { high: 16, low: 14, close: 16 },
  { high: 18, low: 16, close: 18 },
];

// Pure chop: every bar sweeps the whole 10-wide range → Σ TR == period·span →
// CHOP 100.
const CHOPPY: ChopBar[] = [
  { high: 10, low: 10, close: 10 },
  { high: 20, low: 10, close: 10 },
  { high: 20, low: 10, close: 20 },
  { high: 20, low: 10, close: 10 },
  { high: 20, low: 10, close: 20 },
];

// Σ TR == 2·span (ratio 2) → CHOP = 100·log10(2)/log10(4) = 50.
const MID: ChopBar[] = [
  { high: 4, low: 4, close: 4 },
  { high: 12, low: 4, close: 12 },
  { high: 12, low: 4, close: 12 },
  { high: 12, low: 12, close: 12 },
  { high: 12, low: 12, close: 12 },
];

describe('computeChop', () => {
  it('scores a clean trend at 0', () => {
    const r = computeChop(TREND, 4)!;
    expect(r).not.toBeNull();
    expect(r.sumTR).toBe(8);
    expect(r.span).toBe(8);
    expect(r.chop).toBeCloseTo(0, 6);
    expect(r.period).toBe(4);
    expect(r.n).toBe(5);
  });

  it('scores pure chop at 100', () => {
    const r = computeChop(CHOPPY, 4)!;
    expect(r.sumTR).toBe(40);
    expect(r.span).toBe(10);
    expect(r.chop).toBeCloseTo(100, 6);
  });

  it('scores a 2x range ratio at 50', () => {
    const r = computeChop(MID, 4)!;
    expect(r.sumTR).toBe(16);
    expect(r.span).toBe(8);
    expect(r.chop).toBeCloseTo(50, 6); // 100·log10(2)/log10(4)
  });

  it('returns null with too few bars or a flat (zero-span) window', () => {
    expect(computeChop(TREND, 14)).toBeNull(); // needs 15 bars
    expect(
      computeChop(
        [
          { high: 10, low: 10, close: 10 },
          { high: 10, low: 10, close: 10 },
          { high: 10, low: 10, close: 10 },
        ],
        2,
      ),
    ).toBeNull(); // span 0
  });

  it('ignores bars older than the window', () => {
    const padded: ChopBar[] = [
      { high: 99, low: 1, close: 50 },
      { high: 99, low: 1, close: 50 },
      ...TREND,
    ];
    const r = computeChop(padded, 4)!;
    expect(r.chop).toBeCloseTo(0, 6); // same clean trend over the last 4 bars
    expect(r.n).toBe(7);
  });
});

describe('chopRegime', () => {
  it('labels by the Fibonacci thresholds', () => {
    expect(chopRegime(20)).toBe('trend');
    expect(chopRegime(50)).toBe('mixed');
    expect(chopRegime(80)).toBe('chop');
  });
});

describe('chopBoard', () => {
  const series = [
    { symbol: 'TREND', bars: TREND },
    { symbol: 'CHOPPY', bars: CHOPPY },
    { symbol: 'MID', bars: MID },
  ];

  it('defaults to sorting by CHOP ascending (trends first)', () => {
    const rows = chopBoard(series, 'chop', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['TREND', 'MID', 'CHOPPY']); // 0 < 50 < 100
  });

  it('sorts by symbol', () => {
    const rows = chopBoard(series, 'symbol', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['CHOPPY', 'MID', 'TREND']);
  });

  it('skips symbols with too little history', () => {
    const rows = chopBoard(
      [
        { symbol: 'OK', bars: TREND },
        { symbol: 'THIN', bars: [{ high: 10, low: 9, close: 10 }] },
      ],
      'chop',
      4,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortChop', () => {
  it('orders by chop ascending', () => {
    const rows = [
      { symbol: 'A', chop: 70 },
      { symbol: 'B', chop: 20 },
      { symbol: 'C', chop: 45 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(sortChop(rows, 'chop').map((r: { symbol: string }) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
