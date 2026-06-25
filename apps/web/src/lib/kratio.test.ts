import { describe, it, expect } from 'vitest';
import { computeKRatio, kratioBoard, sortKratio, type KRow } from './kratio';

describe('computeKRatio', () => {
  it('matches a hand-computed regression t-stat', () => {
    // closes = [1, e, e², e] → log y = [0, 1, 2, 1] over x = [0,1,2,3].
    // slope 0.4, SSE 1.2 → s² 0.6, Sxx 5 → SE √0.12 → K = 0.4/√0.12.
    const r = computeKRatio([1, Math.E, Math.E ** 2, Math.E])!;
    expect(r.slope).toBeCloseTo(0.4, 9);
    expect(r.rsq).toBeCloseTo(0.4, 9); // Sxy²/(Sxx·Syy) = 4/(5·2)
    expect(r.kratio).toBeCloseTo(0.4 / Math.sqrt(0.12), 6);
    expect(r.n).toBe(4);
  });

  it('returns a null K-ratio for a numerically-perfect log-linear climb', () => {
    // close = 2^t → log is exactly linear → zero residual error.
    const r = computeKRatio([1, 2, 4, 8, 16])!;
    expect(r.slope).toBeCloseTo(Math.LN2, 9);
    expect(r.rsq).toBeCloseTo(1, 9);
    expect(r.kratio).toBeNull();
  });

  it('gives a flat series slope 0 and a null K-ratio', () => {
    const r = computeKRatio([100, 100, 100, 100])!;
    expect(r.slope).toBeCloseTo(0, 12);
    expect(r.kratio).toBeNull();
  });

  it('scores a steady climb far above a jagged one', () => {
    const steady = computeKRatio([100, 102, 104, 106, 108, 110, 112])!;
    const jagged = computeKRatio([100, 130, 90, 140, 85, 120, 112])!;
    expect(steady.kratio!).toBeGreaterThan(jagged.kratio!);
  });

  it('returns null with fewer than three positive closes', () => {
    expect(computeKRatio([100, 110])).toBeNull();
    expect(computeKRatio([100])).toBeNull();
  });
});

describe('kratioBoard / sortKratio', () => {
  const steady = [100, 101, 103, 104, 106, 108, 109, 111];
  const choppy = [100, 95, 108, 92, 110, 98, 115, 104];
  const flat = [100, 100, 100, 100, 100];

  it('drops too-short series and ranks the steadiest climber first', () => {
    const board = kratioBoard([
      { symbol: 'STEADY', closes: steady },
      { symbol: 'CHOP', closes: choppy },
      { symbol: 'FLAT', closes: flat },
      { symbol: 'SHORT', closes: [100, 101] },
    ]);
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    expect(board[0].symbol).toBe('STEADY');
    // FLAT has a null K-ratio and sinks to the bottom.
    expect(board[board.length - 1].symbol).toBe('FLAT');
    expect(board[board.length - 1].kratio).toBeNull();
  });

  it('sorts by slope and by symbol', () => {
    const rows: KRow[] = [
      { symbol: 'ZZZ', kratio: 5, slope: 0.01, rsq: 0.9, n: 50 },
      { symbol: 'AAA', kratio: 3, slope: 0.02, rsq: 0.8, n: 50 },
    ];
    expect(sortKratio(rows, 'slope')[0].symbol).toBe('AAA'); // bigger slope
    expect(sortKratio(rows, 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
