import { describe, it, expect } from 'vitest';
import {
  computeDeMarker,
  deMarkerZone,
  deMarkerBoard,
  sortDeMarker,
  type DeMarkerBar,
  type DeMarkerRow,
} from './deMarker';

const mk = (hl: [number, number][]): DeMarkerBar[] => hl.map(([high, low]) => ({ high, low }));

describe('computeDeMarker', () => {
  it('matches the hand-computed fixture (period 5)', () => {
    // Trailing DeMax over indices 1..5 = 1 + 0 + 1.5 + 0 + 1.5 = 4; DeMin = 0.5.
    // DEM = 100·4 / (4 + 0.5) = 88.888…
    const bars = mk([
      [10, 8],
      [11, 9],
      [10.5, 9.5],
      [12, 10],
      [11.5, 11],
      [13, 10.5],
    ]);
    const r = computeDeMarker(bars, 5)!;
    expect(r.dem).toBeCloseTo(88.88888888888889, 10);
    expect(r.zone).toBe('overbought');
    expect(r.n).toBe(6);
  });

  it('reads 100 on a pure uptrend and 0 on a pure downtrend', () => {
    const up = mk(Array.from({ length: 8 }, (_, i) => [100 + i, 90 + i]));
    const down = mk(Array.from({ length: 8 }, (_, i) => [100 - i, 90 - i]));
    expect(computeDeMarker(up, 5)!.dem).toBe(100);
    expect(computeDeMarker(down, 5)!.dem).toBe(0);
  });

  it('defines a flat (no-movement) market as 50 / neutral', () => {
    const flat = mk(Array.from({ length: 8 }, () => [5, 3]));
    const r = computeDeMarker(flat, 5)!;
    expect(r.dem).toBe(50);
    expect(r.zone).toBe('neutral');
  });

  it('is scale-invariant — the same bar shape at any price gives the same DEM', () => {
    const bars = mk([
      [10, 8],
      [11, 9],
      [10.5, 9.5],
      [12, 10],
      [11.5, 11],
      [13, 10.5],
    ]);
    const scaled = bars.map((b) => ({ high: b.high * 1000, low: b.low * 1000 }));
    expect(computeDeMarker(scaled, 5)!.dem).toBeCloseTo(88.88888888888889, 9);
  });

  it('returns null with fewer than period + 1 bars or bad params', () => {
    const bars = mk(Array.from({ length: 6 }, (_, i) => [10 + i, 8 + i]));
    expect(computeDeMarker(bars.slice(0, 5), 5)).toBeNull(); // need ≥ 6
    expect(computeDeMarker([], 14)).toBeNull();
    expect(computeDeMarker(bars, 0)).toBeNull();
  });
});

describe('deMarkerZone', () => {
  it('classifies against the 70 / 30 guides', () => {
    expect(deMarkerZone(82)).toBe('overbought');
    expect(deMarkerZone(70)).toBe('overbought');
    expect(deMarkerZone(50)).toBe('neutral');
    expect(deMarkerZone(30)).toBe('oversold');
    expect(deMarkerZone(12)).toBe('oversold');
  });
});

describe('deMarkerBoard / sortDeMarker', () => {
  const up = mk(Array.from({ length: 10 }, (_, i) => [100 + i, 90 + i])); // dem 100
  const down = mk(Array.from({ length: 10 }, (_, i) => [100 - i, 90 - i])); // dem 0
  const flat = mk(Array.from({ length: 10 }, () => [5, 3])); // dem 50
  const series = [
    { symbol: 'UP', bars: up },
    { symbol: 'DN', bars: down },
    { symbol: 'FL', bars: flat },
  ];

  it('sorts by DEM descending by default', () => {
    const rows = deMarkerBoard(series, 'dem', 5);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'FL', 'DN']);
  });

  it('sorts by symbol', () => {
    const rows = deMarkerBoard(series, 'symbol', 5);
    expect(rows.map((r) => r.symbol)).toEqual(['DN', 'FL', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = deMarkerBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: up.slice(0, 4) },
      ],
      'dem',
      5,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortDeMarker orders a plain row set by DEM descending', () => {
    const rows = [
      { symbol: 'A', dem: 22 },
      { symbol: 'B', dem: 81 },
      { symbol: 'C', dem: 55 },
    ] as DeMarkerRow[];
    expect(sortDeMarker(rows, 'dem').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
