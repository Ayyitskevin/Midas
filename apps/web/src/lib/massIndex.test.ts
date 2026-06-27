import { describe, it, expect } from 'vitest';
import { computeMassIndex, massBoard, sortMass, type MassBar, type MassRow } from './massIndex';

const bar = (high: number, low: number): MassBar => ({ high, low });

// Fixtures + expected values derived and adversarially verified (2/2 independent
// recomputations, one from a clean-room Node re-implementation, to full f64).
// All emaPeriod=2, sumPeriod=2, with tiny bulge/trigger levels so the 2-ratio
// sum (~2.0) actually crosses them and exercises every state.

// Constant range → ratio 1 → MI flat at 2.0, below the 2.5 bulge → normal.
const normal: MassBar[] = [bar(10, 8), bar(11, 9), bar(12, 10), bar(13, 11), bar(14, 12), bar(15, 13)];
// Sustained range expansion → MI climbs and stays ≥ 2.0 → bulge.
const bulge: MassBar[] = [bar(10, 9), bar(12, 9), bar(18, 10), bar(30, 10), bar(60, 10), bar(140, 10)];
// Expand then contract so the last MI lands in [trigger 1.98, bulge 2.0) → setup.
const setup: MassBar[] = [bar(10, 9), bar(14, 9), bar(40, 10), bar(110, 10), bar(91, 10), bar(45, 10)];
// Plateau arms setup, final-bar collapse drops the last MI below 1.98 → fired.
const fired: MassBar[] = [bar(10, 9), bar(30, 0), bar(30, 0), bar(30, 0), bar(10, 9)];

describe('computeMassIndex', () => {
  it('stays normal when the range does not expand', () => {
    const r = computeMassIndex(normal, 2, 2, 2.5, 1.98)!;
    expect(r.mass).toBeCloseTo(2, 6);
    expect(r.state).toBe('normal');
    expect(r.n).toBe(6);
  });

  it('flags an active bulge when MI is elevated', () => {
    const r = computeMassIndex(bulge, 2, 2, 2, 1.98)!;
    expect(r.mass).toBeCloseTo(2.6061505321962177, 6);
    expect(r.state).toBe('bulge');
  });

  it('flags setup when a bulge occurred but MI sits above the trigger', () => {
    const r = computeMassIndex(setup, 2, 2, 2, 1.98)!;
    expect(r.mass).toBeCloseTo(1.9919962898620958, 6);
    expect(r.state).toBe('setup'); // 1.992 < 2.0 (not bulge) and 1.992 ≮ 1.98 (no fire)
  });

  it('fires when MI drops below the trigger after a bulge', () => {
    const r = computeMassIndex(fired, 2, 2, 2, 1.98)!;
    expect(r.mass).toBeCloseTo(1.732734975574624, 6);
    expect(r.state).toBe('fired');
  });

  it('returns null with fewer than sumPeriod bars', () => {
    expect(computeMassIndex([bar(10, 8)], 2, 2, 2, 1.98)).toBeNull();
    expect(computeMassIndex([], 2, 2, 2, 1.98)).toBeNull();
  });
});

describe('massBoard', () => {
  const series = [
    { symbol: 'HOT', bars: bulge }, // mass ≈ 2.606
    { symbol: 'CALM', bars: normal }, // mass = 2.0
  ];

  it('defaults to sorting by Mass Index descending', () => {
    const rows = massBoard(series, 'mass', 2, 2, 2, 1.98);
    expect(rows.map((r) => r.symbol)).toEqual(['HOT', 'CALM']);
    expect(rows[0].state).toBe('bulge');
  });

  it('sorts by symbol', () => {
    const rows = massBoard(series, 'symbol', 2, 2, 2, 1.98);
    expect(rows.map((r) => r.symbol)).toEqual(['CALM', 'HOT']);
  });

  it('skips symbols with too little history', () => {
    const rows = massBoard(
      [
        { symbol: 'OK', bars: bulge },
        { symbol: 'THIN', bars: [bar(10, 8)] },
      ],
      'mass',
      2,
      2,
      2,
      1.98,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortMass', () => {
  it('orders by Mass Index descending', () => {
    const rows = [
      { symbol: 'A', mass: 25 },
      { symbol: 'B', mass: 28 },
      { symbol: 'C', mass: 22 },
    ] as MassRow[];
    expect(sortMass(rows, 'mass').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
