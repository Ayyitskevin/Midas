import { describe, it, expect } from 'vitest';
import { computeKst, kstBoard, sortKst, type KstRow } from './kst';

// Small params let the whole ROC → SMA → weighted-sum → signal chain be computed
// by hand. Verified by a 3-way adversarial recomputation: closes below under
// rocPeriods [1,2] / smaPeriods [2,2] / weights [1,2] / signal 2 give
// KST = 13.006370 and signal = 9.159354 at the last bar.
const ROC = [1, 2];
const SMA = [2, 2];
const W = [1, 2];
const SIG = 2;
const kst = (closes: number[]) => computeKst(closes, ROC, SMA, W, SIG);

const ramp = (from: number, to: number) => {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v);
  return out;
};

describe('computeKst', () => {
  it('matches the exact worked micro-example', () => {
    const r = kst([100, 102, 105, 103, 108, 110])!;
    expect(r).not.toBeNull();
    expect(r.kst).toBeCloseTo(13.006370, 5);
    expect(r.signal).toBeCloseTo(9.159354, 5);
    expect(r.hist).toBeCloseTo(13.006370 - 9.159354, 5);
    expect(r.dir).toBe('up');
    expect(r.side).toBe('pos');
    expect(r.n).toBe(6);
  });

  it('is exactly zero on a flat series', () => {
    const r = kst([100, 100, 100, 100, 100, 100])!;
    expect(r.kst).toBe(0);
    expect(r.signal).toBe(0);
    expect(r.hist).toBe(0);
  });

  it('reads a steady uptrend as positive momentum', () => {
    const r = kst(ramp(1, 12))!;
    expect(r.kst).toBeGreaterThan(0);
    expect(r.side).toBe('pos');
  });

  it('reads a steady downtrend as negative momentum', () => {
    const r = kst(ramp(40, 20))!;
    expect(r.kst).toBeLessThan(0);
    expect(r.side).toBe('neg');
  });

  it('returns null below the required history', () => {
    expect(kst(ramp(1, 4))).toBeNull(); // 4 closes, needs max(roc+sma)+signal-1 = 5
    expect(computeKst(ramp(1, 40))).toBeNull(); // defaults need 53 closes
    expect(computeKst([])).toBeNull();
  });

  it('returns null on malformed params', () => {
    expect(computeKst(ramp(1, 10), [1, 2], [2], [1, 2], 2)).toBeNull(); // length mismatch
    expect(computeKst(ramp(1, 10), [1, 2], [2, 2], [1, 2], 0)).toBeNull(); // signal < 1
    expect(computeKst(ramp(1, 10), [0], [2], [1], 2)).toBeNull(); // roc period < 1
  });
});

describe('kstBoard / sortKst', () => {
  it('sorts by KST descending and by symbol / histogram', () => {
    const up = { symbol: 'UP', ...kst(ramp(1, 12))! };
    const down = { symbol: 'DOWN', ...kst(ramp(40, 20))! };
    const rows: KstRow[] = [down, up];

    expect(sortKst(rows, 'kst')[0].symbol).toBe('UP'); // up has the higher KST
    expect(sortKst(rows, 'symbol').map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
    const byHist = sortKst(rows, 'hist');
    expect(byHist[0].hist).toBeGreaterThanOrEqual(byHist[1].hist); // descending by histogram
  });

  it('skips symbols with too little history (default params)', () => {
    const board = kstBoard([
      { symbol: 'THIN', closes: ramp(1, 30) }, // < 53 → skipped
      { symbol: 'ALSO_THIN', closes: ramp(1, 10) },
    ]);
    expect(board).toEqual([]);
  });
});
