import { describe, it, expect } from 'vitest';
import { computeParabolicSar, parabolicSarBoard, sortSar, type SarBar, type SarRow } from './parabolicSar';

const bar = (high: number, low: number, close: number): SarBar => ({ high, low, close });

// Fixtures + expected final state hand-simulated and adversarially verified
// (3/3 independent re-simulations, two with exact rational arithmetic).
// Params: af0 0.02, afStep 0.02, afMax 0.20 unless noted.

// Clean uptrend, stays long the whole way (AF steps 0.02→0.12, never flips).
const uptrend: SarBar[] = [
  bar(10, 8, 9),
  bar(12, 9, 11),
  bar(14, 11, 13),
  bar(16, 13, 15),
  bar(18, 15, 17),
  bar(20, 17, 19),
  bar(22, 19, 21),
];

// Monotonic uptrend long enough that AF reaches the 0.20 cap (cap binds on the last bar).
const capBinds: SarBar[] = [
  bar(10, 9, 9.5),
  bar(11, 9.5, 10.8),
  bar(12, 10.5, 11.8),
  bar(13, 11.5, 12.8),
  bar(14, 12.5, 13.8),
  bar(15, 13.5, 14.8),
  bar(16, 14.5, 15.8),
  bar(17, 15.5, 16.8),
  bar(18, 16.5, 17.8),
  bar(19, 17.5, 18.8),
  bar(20, 18.5, 19.8),
  bar(21, 19.5, 20.8),
];

// Long until the final bar, which gaps down and pierces the stop → flip to short.
const flipLast: SarBar[] = [bar(10, 8, 9), bar(12, 9, 11), bar(14, 11, 13), bar(16, 13, 15), bar(18, 15, 17), bar(19, 4, 5)];

// Reversal happens mid-sequence; the final bars continue short with no fresh flip.
const midReversal: SarBar[] = [
  bar(20, 18, 19),
  bar(22, 19, 21),
  bar(24, 21, 23),
  bar(25, 22, 24),
  bar(23, 10, 11),
  bar(12, 8, 9),
  bar(10, 6, 7),
];

describe('computeParabolicSar', () => {
  it('tracks a clean uptrend long, stepping AF, no flip', () => {
    const r = computeParabolicSar(uptrend, 0.02, 0.02, 0.2)!;
    expect(r.side).toBe('long');
    expect(r.sar).toBeCloseTo(10.5042368, 6);
    expect(r.ep).toBe(22);
    expect(r.af).toBeCloseTo(0.12, 6);
    expect(r.flip).toBe(false);
    expect(r.dist).toBeCloseTo(((21 - 10.5042368) / 21) * 100, 6);
    expect(r.n).toBe(7);
  });

  it('caps AF at afMax on a long monotonic run', () => {
    const r = computeParabolicSar(capBinds, 0.02, 0.02, 0.2)!;
    expect(r.side).toBe('long');
    expect(r.af).toBeCloseTo(0.2, 6); // would be 0.22 but the cap binds
    expect(r.ep).toBe(21);
    expect(r.sar).toBeCloseTo(15.1220434, 5); // full precision 15.122043366…
    expect(r.flip).toBe(false);
  });

  it('flips long→short on the latest bar (SAR jumps to the prior EP)', () => {
    const r = computeParabolicSar(flipLast, 0.02, 0.02, 0.2)!;
    expect(r.side).toBe('short');
    expect(r.sar).toBe(18); // the prior extreme point, not the clamped projection
    expect(r.ep).toBe(4);
    expect(r.af).toBeCloseTo(0.02, 6);
    expect(r.flip).toBe(true);
  });

  it('continues short with no fresh flip after a mid-sequence reversal', () => {
    const r = computeParabolicSar(midReversal, 0.02, 0.02, 0.2)!;
    expect(r.side).toBe('short');
    expect(r.sar).toBeCloseTo(24.32, 6);
    expect(r.ep).toBe(6);
    expect(r.af).toBeCloseTo(0.06, 6);
    expect(r.flip).toBe(false);
  });

  it('returns null below the 3-bar minimum', () => {
    expect(computeParabolicSar([bar(11, 9, 10), bar(12, 10, 11)], 0.02, 0.02, 0.2)).toBeNull();
    expect(computeParabolicSar([], 0.02, 0.02, 0.2)).toBeNull();
  });
});

describe('parabolicSarBoard', () => {
  const series = [
    { symbol: 'LONG', bars: uptrend },
    { symbol: 'SHORT', bars: flipLast },
  ];

  it('defaults to sorting by distance from the stop descending', () => {
    const rows = parabolicSarBoard(series, 'dist', 0.02, 0.02, 0.2);
    // LONG (price well above its stop, +dist) ranks above SHORT (price below, −dist).
    expect(rows.map((r) => r.symbol)).toEqual(['LONG', 'SHORT']);
    expect(rows[0].side).toBe('long');
    expect(rows[1].side).toBe('short');
  });

  it('sorts longs before shorts', () => {
    const rows = parabolicSarBoard(series, 'side', 0.02, 0.02, 0.2);
    expect(rows.map((r) => r.side)).toEqual(['long', 'short']);
  });

  it('skips symbols with too little history', () => {
    const rows = parabolicSarBoard(
      [
        { symbol: 'OK', bars: uptrend },
        { symbol: 'THIN', bars: [bar(11, 9, 10), bar(12, 10, 11)] },
      ],
      'dist',
      0.02,
      0.02,
      0.2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortSar', () => {
  it('orders by distance descending', () => {
    const rows = [
      { symbol: 'A', dist: 3, side: 'long' },
      { symbol: 'B', dist: 9, side: 'long' },
      { symbol: 'C', dist: -4, side: 'short' },
    ] as SarRow[];
    expect(sortSar(rows, 'dist').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
