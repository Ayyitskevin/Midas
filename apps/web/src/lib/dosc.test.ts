import { describe, it, expect } from 'vitest';
import { computeDosc, doscBoard, sortDosc, type DoscRow } from './dosc';

// Small periods let the Wilder RSI → EMA(s1) → EMA(s2) → SMA(sig) → histogram
// cascade be computed by hand. Verified by a 3-way adversarial recomputation
// against Constance Brown's formula: closes below under rsiLength=2 / s1=2 /
// s2=2 / sigLength=2 give DOSC = −4.3884 (doLine 64.8112, signal 69.1996).
const MIX = [100, 102, 101, 103, 102, 105, 104, 106, 105];

describe('computeDosc', () => {
  it('matches the exact worked micro-example', () => {
    const r = computeDosc(MIX, 2, 2, 2, 2)!;
    expect(r).not.toBeNull();
    expect(r.dosc).toBeCloseTo(-4.3884, 3);
    expect(r.doLine).toBeCloseTo(64.8112, 3);
    expect(r.signal).toBeCloseTo(69.1996, 3);
    expect(r.prev).toBeCloseTo(2.6525, 3);
    expect(r.dir).toBe('down');
    expect(r.side).toBe('neg');
    expect(r.n).toBe(9);
  });

  it('keeps the histogram identity dosc = doLine − signal', () => {
    const r = computeDosc(MIX, 2, 2, 2, 2)!;
    expect(r.dosc).toBeCloseTo(r.doLine - r.signal, 9);
  });

  it('is zero when the RSI never moves (flat closes)', () => {
    // Flat closes → no deltas → RSI pinned at 100 → double-smoothed 100 → signal
    // 100 → histogram 0.
    const flat = Array.from({ length: 12 }, () => 100);
    const r = computeDosc(flat, 2, 2, 2, 2)!;
    expect(r.dosc).toBe(0);
    expect(r.doLine).toBe(100);
    expect(r.side).toBe('pos');
  });

  it('returns null below rsiLength + s1 + s2 + sigLength closes', () => {
    expect(computeDosc(MIX.slice(0, 7), 2, 2, 2, 2)).toBeNull(); // 7 closes, needs 8
    expect(computeDosc(MIX)).toBeNull(); // 9 closes, defaults need 31
    expect(computeDosc([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeDosc(MIX, 0, 2, 2, 2)).toBeNull();
    expect(computeDosc(MIX, 2, 2, 2, 0)).toBeNull();
  });
});

describe('doscBoard / sortDosc', () => {
  it('skips thin history and keeps computable symbols', () => {
    const board = doscBoard(
      [
        { symbol: 'OK', closes: MIX },
        { symbol: 'THIN', closes: MIX.slice(0, 5) },
      ],
      'dosc',
      2,
      2,
      2,
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sorts by dosc, symbol, and slope', () => {
    const a: DoscRow = { symbol: 'AAA', ...computeDosc(MIX, 2, 2, 2, 2)!, dosc: 5, prev: 1 };
    const b: DoscRow = { symbol: 'BBB', ...computeDosc(MIX, 2, 2, 2, 2)!, dosc: -2, prev: 1 };
    expect(sortDosc([b, a], 'dosc')[0].symbol).toBe('AAA');
    expect(sortDosc([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortDosc([b, a], 'slope')[0].symbol).toBe('AAA'); // +4 slope beats −3
  });
});
