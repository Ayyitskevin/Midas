import { describe, it, expect } from 'vitest';
import { computeObv, obvBoard, sortObv, type ObvBar } from './obv';

// Pure accumulation: three up days of 100 volume each → OBV 0,100,200,300.
const ACC: ObvBar[] = [
  { close: 100, volume: 50 },
  { close: 101, volume: 100 },
  { close: 102, volume: 100 },
  { close: 103, volume: 100 },
];

// Pure distribution: three down days of 80 volume each → OBV 0,−80,−160,−240.
const DIST: ObvBar[] = [
  { close: 100, volume: 50 },
  { close: 99, volume: 80 },
  { close: 98, volume: 80 },
  { close: 97, volume: 80 },
];

// Mixed: up, down, up → OBV 0,100,0,100.
const MIX: ObvBar[] = [
  { close: 100, volume: 100 },
  { close: 102, volume: 100 },
  { close: 100, volume: 100 },
  { close: 101, volume: 100 },
];

describe('computeObv', () => {
  it('measures pure accumulation', () => {
    const r = computeObv(ACC)!;
    expect(r).not.toBeNull();
    expect(r.obv).toBe(300);
    expect(r.flow).toBe(1); // all directional volume on up days
    expect(r.slopePct).toBeCloseTo(100, 6); // OBV rises one avg-volume per bar
    expect(r.up).toBe(300);
    expect(r.down).toBe(0);
    expect(r.n).toBe(3);
  });

  it('measures pure distribution', () => {
    const r = computeObv(DIST)!;
    expect(r.obv).toBe(-240);
    expect(r.flow).toBe(-1);
    expect(r.slopePct).toBeCloseTo(-100, 6);
  });

  it('nets a mixed series', () => {
    const r = computeObv(MIX)!;
    expect(r.obv).toBe(100); // 0,100,0,100
    expect(r.flow).toBeCloseTo(1 / 3, 6); // up 200, down 100
    expect(r.slopePct).toBeCloseTo(20, 6); // regression slope 20, avg vol 100
    expect(r.up).toBe(200);
    expect(r.down).toBe(100);
  });

  it('returns null below the minimum bars or with no directional volume', () => {
    expect(computeObv([])).toBeNull();
    expect(
      computeObv([
        { close: 100, volume: 50 },
        { close: 101, volume: 100 },
      ]),
    ).toBeNull();
    // All flat closes → no up/down volume.
    expect(
      computeObv([
        { close: 100, volume: 10 },
        { close: 100, volume: 10 },
        { close: 100, volume: 10 },
      ]),
    ).toBeNull();
  });

  it('honours the window argument, ignoring older bars', () => {
    const bars: ObvBar[] = [
      { close: 100, volume: 999 }, // outside a 3-bar window
      { close: 200, volume: 999 },
      { close: 50, volume: 100 },
      { close: 51, volume: 100 },
      { close: 52, volume: 100 },
    ];
    const r = computeObv(bars, 3)!;
    expect(r.obv).toBe(200); // only the last 3 bars: 0,100,200
    expect(r.flow).toBe(1);
    expect(r.n).toBe(2);
  });
});

describe('obvBoard', () => {
  const series = [
    { symbol: 'ACC', bars: ACC },
    { symbol: 'DIST', bars: DIST },
    { symbol: 'MIX', bars: MIX },
  ];

  it('defaults to sorting by accumulation slope descending', () => {
    const rows = obvBoard(series);
    expect(rows.map((r) => r.symbol)).toEqual(['ACC', 'MIX', 'DIST']); // slopePct 100 > 20 > −100
  });

  it('sorts by symbol', () => {
    const rows = obvBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['ACC', 'DIST', 'MIX']);
  });

  it('skips symbols with too little history', () => {
    const rows = obvBoard([
      { symbol: 'OK', bars: ACC },
      { symbol: 'THIN', bars: [{ close: 10, volume: 5 }] },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortObv', () => {
  it('orders by flow descending', () => {
    const rows = [
      { symbol: 'A', flow: 0.2 },
      { symbol: 'B', flow: 0.9 },
      { symbol: 'C', flow: -0.5 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(sortObv(rows, 'flow').map((r: { symbol: string }) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
