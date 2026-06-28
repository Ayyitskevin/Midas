import { describe, it, expect } from 'vitest';
import { computeCg, cgBoard, sortCg, type CgBar, type CgRow } from './cg';

// median = high = low = m, so the fixtures are exact and hand-checkable.
const bar = (m: number): CgBar => ({ high: m, low: m });

// Primary fixture — hand-computed. Medians 3,4,5,6 with length 3.
// Latest window (4,5,6): Num = 1·6 + 2·5 + 3·4 = 28, Den = 15 → CG = −28/15 + 2 = 2/15.
// Prior window (3,4,5): Num = 1·5 + 2·4 + 3·3 = 22, Den = 12 → CG = −22/12 + 2 = 1/6.
const primary = [bar(3), bar(4), bar(5), bar(6)];
// Flat then an up-tick → CG turns up on the last bar (bull cross): series [0, 0, 1/19].
const bull = [bar(6), bar(6), bar(6), bar(6), bar(7)];
// Up-tick then back down → CG turns down on the last bar (bear cross): series [0, 1/19, 0].
const bear = [bar(6), bar(6), bar(6), bar(7), bar(6)];

describe('computeCg', () => {
  it('matches the hand-computed centre of gravity and trigger', () => {
    const r = computeCg(primary, 3)!;
    expect(r.cg).toBeCloseTo(2 / 15, 12);
    expect(r.trigger).toBeCloseTo(1 / 6, 12);
    expect(r.cross).toBe('none'); // only two CG readings → no cross yet
    expect(r.n).toBe(4);
  });

  it('fires a bull cross when CG turns up on the last bar', () => {
    const r = computeCg(bull, 3)!;
    expect(r.cg).toBeCloseTo(1 / 19, 12);
    expect(r.trigger).toBeCloseTo(0, 12);
    expect(r.cross).toBe('bull');
  });

  it('fires a bear cross when CG turns down on the last bar', () => {
    const r = computeCg(bear, 3)!;
    expect(r.cg).toBeCloseTo(0, 12);
    expect(r.trigger).toBeCloseTo(1 / 19, 12);
    expect(r.cross).toBe('bear');
  });

  it('is scale-invariant (a dimensionless price ratio)', () => {
    const scaled = primary.map((b) => ({ high: b.high * 1000, low: b.low * 1000 }));
    expect(computeCg(scaled, 3)!.cg).toBeCloseTo(computeCg(primary, 3)!.cg, 12);
  });

  it('stays within ±(length−1)/2', () => {
    const r = computeCg(primary, 3)!;
    expect(Math.abs(r.cg)).toBeLessThanOrEqual((3 - 1) / 2);
  });

  it('returns null with fewer than `length` bars', () => {
    expect(computeCg([bar(1), bar(2)], 3)).toBeNull();
    expect(computeCg([], 3)).toBeNull();
  });

  it('rejects a non-positive length', () => {
    expect(computeCg(primary, 0)).toBeNull();
  });
});

describe('cgBoard', () => {
  const series = [
    { symbol: 'PRIM', bars: primary }, // cg ≈ 0.1333
    { symbol: 'BULL', bars: bull }, // cg ≈ 0.0526
    { symbol: 'BEAR', bars: bear }, // cg = 0
  ];

  it('defaults to sorting by CG descending', () => {
    const rows = cgBoard(series, 'cg', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['PRIM', 'BULL', 'BEAR']);
  });

  it('sorts by symbol', () => {
    const rows = cgBoard(series, 'symbol', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['BEAR', 'BULL', 'PRIM']);
  });

  it('skips symbols with too little history', () => {
    const rows = cgBoard(
      [
        { symbol: 'OK', bars: primary },
        { symbol: 'THIN', bars: [bar(1), bar(2)] },
      ],
      'cg',
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCg', () => {
  it('orders by CG descending', () => {
    const rows = [
      { symbol: 'A', cg: 0.3 },
      { symbol: 'B', cg: 1.2 },
      { symbol: 'C', cg: -0.5 },
    ] as CgRow[];
    expect(sortCg(rows, 'cg').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
