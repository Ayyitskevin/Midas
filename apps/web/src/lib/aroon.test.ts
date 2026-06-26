import { describe, it, expect } from 'vitest';
import { computeAroon, aroonBoard, sortAroon, type AroonBar, type AroonRow } from './aroon';

const mk = (hl: [number, number][]): AroonBar[] => hl.map(([high, low]) => ({ high, low }));

// period 4 → window of 5 bars. Fresh high on the last bar, oldest low first.
const fresh = mk([
  [10, 5],
  [11, 6],
  [12, 7],
  [13, 8],
  [14, 9],
]);
// Mirror: fresh low on the last bar, oldest high first.
const falling = mk([
  [14, 9],
  [13, 8],
  [12, 7],
  [11, 6],
  [10, 5],
]);

describe('computeAroon', () => {
  it('reads a fresh high as Aroon-Up 100', () => {
    const r = computeAroon(fresh, 4)!;
    expect(r).not.toBeNull();
    expect(r.up).toBe(100); // high made on the current bar
    expect(r.down).toBe(0); // low made 4 bars ago
    expect(r.osc).toBe(100);
    expect(r.n).toBe(5);
  });

  it('reads a fresh low as Aroon-Down 100', () => {
    const r = computeAroon(falling, 4)!;
    expect(r.up).toBe(0);
    expect(r.down).toBe(100);
    expect(r.osc).toBe(-100);
  });

  it('measures the age of each extreme', () => {
    // High 16 two bars in (idx1), low 3 three bars in (idx3).
    const r = computeAroon(mk([[10, 5], [16, 4], [12, 8], [11, 3], [13, 9]]), 4)!;
    expect(r.up).toBe(25); // idxHigh 1 / 4
    expect(r.down).toBe(75); // idxLow 3 / 4
    expect(r.osc).toBe(-50);
  });

  it('resolves ties to the most recent extreme', () => {
    // High 14 at idx1 and idx3 → use the later one.
    const r = computeAroon(mk([[10, 5], [14, 6], [12, 7], [14, 8], [11, 9]]), 4)!;
    expect(r.up).toBe(75); // idxHigh 3 / 4
  });

  it('returns null with too little history', () => {
    expect(computeAroon(fresh.slice(0, 4), 4)).toBeNull(); // < period + 1
    expect(computeAroon([], 4)).toBeNull();
  });
});

describe('aroonBoard', () => {
  const series = [
    { symbol: 'UP', bars: fresh },
    { symbol: 'DOWN', bars: falling },
  ];

  it('defaults to sorting by oscillator descending', () => {
    const rows = aroonBoard(series, 'osc', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']); // +100 > −100
  });

  it('sorts by symbol', () => {
    const rows = aroonBoard(series, 'symbol', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = aroonBoard(
      [
        { symbol: 'OK', bars: fresh },
        { symbol: 'THIN', bars: fresh.slice(0, 3) },
      ],
      'osc',
      4,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortAroon', () => {
  it('orders by oscillator descending', () => {
    const rows = [
      { symbol: 'A', osc: 10 },
      { symbol: 'B', osc: 80 },
      { symbol: 'C', osc: -40 },
    ] as AroonRow[];
    expect(sortAroon(rows, 'osc').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
