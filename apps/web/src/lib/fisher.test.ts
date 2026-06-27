import { describe, it, expect } from 'vitest';
import { computeFisher, fisherBoard, sortFisher, type FisherBar, type FisherRow } from './fisher';

const bar = (high: number, low: number): FisherBar => ({ high, low });

// Medians 9,11,13,15,17 (each window fully ranges → raw=1). Hand-computed against
// the workflow-verified recursion (value 0.66·(raw−0.5)+0.67·prev, clamp ±0.999,
// fisher 0.5·ln((1+v)/(1−v))+0.5·prev):
//   value:  0.33, 0.5511, 0.699237   fisher: 0.342856, 0.791397, 1.261527
const rising: FisherBar[] = [bar(10, 8), bar(12, 10), bar(14, 12), bar(16, 14), bar(18, 16)];
// Same, then a 6th bar whose median drops to 11 (raw=0) → Fisher turns down on the
// last bar: value 0.138489, fisher 0.770102 → fresh bear cross.
const turn: FisherBar[] = [...rising, bar(12, 10)];

describe('computeFisher', () => {
  it('climbs positive on a rising series (no cross yet)', () => {
    const r = computeFisher(rising, 3)!;
    expect(r.fisher).toBeCloseTo(1.261527, 4);
    expect(r.trigger).toBeCloseTo(0.791397, 4);
    expect(r.cross).toBe('none');
    expect(r.n).toBe(5);
  });

  it('fires a bear cross when the latest bar turns down', () => {
    const r = computeFisher(turn, 3)!;
    expect(r.fisher).toBeCloseTo(0.770102, 4);
    expect(r.trigger).toBeCloseTo(1.261527, 4);
    expect(r.cross).toBe('bear');
  });

  it('stays finite on a flat (zero-range) series via the clamp', () => {
    const flat = [bar(10, 8), bar(10, 8), bar(10, 8), bar(10, 8), bar(10, 8)];
    const r = computeFisher(flat, 3)!;
    expect(Number.isFinite(r.fisher)).toBe(true);
    expect(r.fisher).toBeLessThan(0); // raw=0 each bar drives value (and Fisher) negative
  });

  it('returns null with fewer than `period` bars', () => {
    expect(computeFisher([bar(10, 8), bar(12, 10)], 3)).toBeNull();
    expect(computeFisher([], 3)).toBeNull();
  });
});

describe('fisherBoard', () => {
  const series = [
    { symbol: 'HIGH', bars: rising }, // fisher ≈ 1.26
    { symbol: 'LOW', bars: turn }, // fisher ≈ 0.77
  ];

  it('defaults to sorting by Fisher descending', () => {
    const rows = fisherBoard(series, 'fisher', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
  });

  it('sorts by symbol', () => {
    const rows = fisherBoard(series, 'symbol', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
  });

  it('skips symbols with too little history', () => {
    const rows = fisherBoard(
      [
        { symbol: 'OK', bars: rising },
        { symbol: 'THIN', bars: [bar(10, 8), bar(12, 10)] },
      ],
      'fisher',
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortFisher', () => {
  it('orders by Fisher descending', () => {
    const rows = [
      { symbol: 'A', fisher: 0.3 },
      { symbol: 'B', fisher: 1.2 },
      { symbol: 'C', fisher: -0.5 },
    ] as FisherRow[];
    expect(sortFisher(rows, 'fisher').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
