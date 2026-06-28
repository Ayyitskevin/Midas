import { describe, it, expect } from 'vitest';
import { computeRvi, rviBoard, sortRvi, rviZone, rviSeries, type RviRow } from './rvi';
import { computeInertia } from './inertia';

// Primary fixture — the Wilder-smoothed RVI (population stdev, close-based), the
// same convention the Inertia board uses. Independently verified by a multi-agent
// workflow (Wilder/SMA-seed branch) and re-checked: RVI = 50.425332.
const primary = [50, 51, 52, 51, 53, 54, 53, 55, 56, 55, 57, 58, 57, 59, 60, 59];
const up = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
const down = [25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];

describe('computeRvi', () => {
  it('matches the workflow-verified RVI', () => {
    const r = computeRvi(primary, 4, 3)!;
    expect(r.rvi).toBeCloseTo(50.425332, 5);
    expect(r.zone).toBe('neutral');
    expect(r.n).toBe(16);
  });

  it('reads 100 on a pure uptrend and 0 on a pure downtrend', () => {
    expect(computeRvi(up, 4, 3)!.rvi).toBeCloseTo(100, 9);
    expect(computeRvi(up, 4, 3)!.zone).toBe('high');
    expect(computeRvi(down, 4, 3)!.rvi).toBeCloseTo(0, 9);
    expect(computeRvi(down, 4, 3)!.zone).toBe('low');
  });

  it('returns null with fewer than stdevPeriod + rviPeriod − 1 closes', () => {
    expect(computeRvi(primary.slice(0, 5), 4, 3)).toBeNull(); // need ≥ 6
    expect(computeRvi([], 4, 3)).toBeNull();
    expect(computeRvi(primary, 0, 3)).toBeNull();
  });

  it('shares its RVI with the Inertia board (single source of truth)', () => {
    // computeInertia exposes the latest raw RVI; it must equal rvi.ts's value.
    const inertia = computeInertia(primary, 4, 3, 5)!;
    const series = rviSeries(primary, 4, 3);
    expect(inertia.rvi).toBe(series[series.length - 1]);
    expect(computeRvi(primary, 4, 3)!.rvi).toBe(inertia.rvi);
  });
});

describe('rviZone', () => {
  it('classifies against the 60 / 40 guides', () => {
    expect(rviZone(72)).toBe('high');
    expect(rviZone(60)).toBe('high');
    expect(rviZone(50)).toBe('neutral');
    expect(rviZone(40)).toBe('low');
    expect(rviZone(15)).toBe('low');
  });
});

describe('rviBoard', () => {
  const series = [
    { symbol: 'UP', closes: up }, // rvi 100
    { symbol: 'MID', closes: primary }, // rvi ≈ 50.4
    { symbol: 'DN', closes: down }, // rvi 0
  ];

  it('defaults to sorting by RVI descending', () => {
    const rows = rviBoard(series, 'rvi', 4, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'MID', 'DN']);
  });

  it('sorts by symbol', () => {
    const rows = rviBoard(series, 'symbol', 4, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['DN', 'MID', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = rviBoard(
      [
        { symbol: 'OK', closes: primary },
        { symbol: 'THIN', closes: primary.slice(0, 5) },
      ],
      'rvi',
      4,
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortRvi', () => {
  it('orders by RVI descending', () => {
    const rows = [
      { symbol: 'A', rvi: 30 },
      { symbol: 'B', rvi: 72 },
      { symbol: 'C', rvi: 51 },
    ] as RviRow[];
    expect(sortRvi(rows, 'rvi').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
