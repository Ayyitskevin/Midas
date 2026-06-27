import { describe, it, expect } from 'vitest';
import { computeEom, eomBoard, sortEom, type EomBar, type EomRow } from './eom';

const bar = (high: number, low: number, volume: number): EomBar => ({ high, low, volume });

// Period 2. Rising midpoints on steady volume → price moves up easily.
//   midpoints 9, 11, 13 → DM = +2, +2; range 2, vol 100 → EMV = [0.04, 0.04]; raw 0.04
//   avgVol(last 2) = 100, avgMid = 12 → eom = 0.04·100/144·100 = 400/144 ≈ 2.7778
const up: EomBar[] = [bar(10, 8, 100), bar(12, 10, 100), bar(14, 12, 100)];
// Falling midpoints → moves down easily. raw −0.04, avgMid = 10 → eom = −0.04·100/100·100 = −4
const down: EomBar[] = [bar(14, 12, 100), bar(12, 10, 100), bar(10, 8, 100)];

describe('computeEom', () => {
  it('is positive when price rises easily (move up on light volume)', () => {
    const r = computeEom(up, 2)!;
    expect(r.eom).toBeCloseTo(400 / 144, 5); // ≈ 2.7778
    expect(r.side).toBe('up');
    expect(r.n).toBe(3);
  });

  it('is negative when price falls easily', () => {
    const r = computeEom(down, 2)!;
    expect(r.eom).toBeCloseTo(-4, 5);
    expect(r.side).toBe('down');
  });

  it('treats zero-range / zero-volume bars as no movement', () => {
    // bar 1 has zero range → EMV 0; bar 2 a normal up-move
    const r = computeEom([bar(10, 8, 100), bar(11, 11, 100), bar(13, 11, 100)], 2)!;
    expect(Number.isFinite(r.eom)).toBe(true);
    expect(r.side).toBe('up'); // the one real move is up
  });

  it('returns null with too little history', () => {
    expect(computeEom([bar(10, 8, 100), bar(12, 10, 100)], 2)).toBeNull(); // n < period + 1
    expect(computeEom([], 2)).toBeNull();
  });
});

describe('eomBoard', () => {
  const series = [
    { symbol: 'EASY', bars: up }, // +2.78
    { symbol: 'HEAVY', bars: down }, // −4
  ];

  it('defaults to sorting by EOM descending', () => {
    const rows = eomBoard(series, 'eom', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['EASY', 'HEAVY']);
    expect(rows[0].side).toBe('up');
    expect(rows[1].side).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = eomBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['EASY', 'HEAVY']);
  });

  it('skips symbols with too little history', () => {
    const rows = eomBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: [bar(10, 8, 100), bar(12, 10, 100)] },
      ],
      'eom',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortEom', () => {
  it('orders by EOM descending', () => {
    const rows = [
      { symbol: 'A', eom: 1 },
      { symbol: 'B', eom: 5 },
      { symbol: 'C', eom: -2 },
    ] as EomRow[];
    expect(sortEom(rows, 'eom').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
