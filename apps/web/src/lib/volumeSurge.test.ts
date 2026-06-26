import { describe, it, expect } from 'vitest';
import { computeVolSurge, volSurgeBoard, sortVolSurge, type VolBar } from './volumeSurge';

// Up-day volume spike: four calm bars averaging 100, then 240 on an up close.
const HOT: VolBar[] = [
  { close: 10, volume: 80 },
  { close: 11, volume: 120 },
  { close: 12, volume: 100 },
  { close: 11, volume: 100 },
  { close: 13, volume: 240 },
];

// Down-day volume spike (distribution): prior avg 57.5, then 200 on a down close.
const DIST: VolBar[] = [
  { close: 100, volume: 50 },
  { close: 98, volume: 60 },
  { close: 99, volume: 55 },
  { close: 97, volume: 65 },
  { close: 90, volume: 200 },
];

// Quiet day: today's volume is half the trailing average.
const COLD: VolBar[] = [
  { close: 10, volume: 100 },
  { close: 11, volume: 110 },
  { close: 12, volume: 90 },
  { close: 11, volume: 100 },
  { close: 12, volume: 50 },
];

describe('computeVolSurge', () => {
  it('measures an up-day volume surge', () => {
    const r = computeVolSurge(HOT, 4)!;
    expect(r).not.toBeNull();
    expect(r.avgVolume).toBeCloseTo(100, 6);
    expect(r.surge).toBeCloseTo(2.4, 6); // 240 / 100
    expect(r.z).toBeCloseTo(9.8995, 3); // (240 - 100) / sqrt(200)
    expect(r.direction).toBe(1); // close 13 > prev 11
    expect(r.n).toBe(5);
  });

  it('flags a down-day surge as distribution', () => {
    const r = computeVolSurge(DIST, 4)!;
    expect(r.surge).toBeCloseTo(3.4783, 3); // 200 / 57.5
    expect(r.direction).toBe(-1); // close 90 < prev 97
  });

  it('reports below-average volume as a surge under 1', () => {
    const r = computeVolSurge(COLD, 4)!;
    expect(r.surge).toBeCloseTo(0.5, 6); // 50 / 100
    expect(r.direction).toBe(1);
  });

  it('returns null below the minimum bars or on a non-positive average', () => {
    expect(computeVolSurge([])).toBeNull();
    expect(
      computeVolSurge([
        { close: 10, volume: 100 },
        { close: 11, volume: 200 },
      ]),
    ).toBeNull();
    // All prior volumes zero → degenerate average.
    expect(
      computeVolSurge([
        { close: 10, volume: 0 },
        { close: 11, volume: 0 },
        { close: 12, volume: 500 },
      ]),
    ).toBeNull();
  });

  it('guards the z-score when the trailing window has no variance', () => {
    const flat: VolBar[] = [
      { close: 10, volume: 100 },
      { close: 11, volume: 100 },
      { close: 12, volume: 100 },
      { close: 13, volume: 100 },
      { close: 14, volume: 250 },
    ];
    const r = computeVolSurge(flat, 4)!;
    expect(r.z).toBe(0); // stdev 0 → cannot standardize
    expect(r.surge).toBeCloseTo(2.5, 6); // 250 / 100
  });
});

describe('volSurgeBoard', () => {
  const series = [
    { symbol: 'HOT', bars: HOT },
    { symbol: 'COLD', bars: COLD },
    { symbol: 'DIST', bars: DIST },
  ];

  it('defaults to sorting by surge descending', () => {
    const rows = volSurgeBoard(series, 'surge', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['DIST', 'HOT', 'COLD']);
    expect(rows[0].direction).toBe(-1); // DIST is a down-day surge
    expect(rows[1].direction).toBe(1); // HOT is an up-day surge
  });

  it('sorts by symbol', () => {
    const rows = volSurgeBoard(series, 'symbol', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['COLD', 'DIST', 'HOT']);
  });

  it('skips symbols with too little history', () => {
    const rows = volSurgeBoard(
      [
        { symbol: 'OK', bars: HOT },
        { symbol: 'THIN', bars: [{ close: 10, volume: 100 }] },
      ],
      'surge',
      4,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortVolSurge', () => {
  it('orders by z descending', () => {
    const rows = [
      { symbol: 'A', z: 1.2 },
      { symbol: 'B', z: 4.5 },
      { symbol: 'C', z: -0.3 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(sortVolSurge(rows, 'z').map((r: { symbol: string }) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
