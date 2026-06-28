import { describe, it, expect } from 'vitest';
import { adlSeries, computeCho, choBoard, sortCho, type ChoBar, type ChoRow } from './cho';

/** Bar with the close sitting at a chosen spot in the range. */
const bar = (close: number, high: number, low: number, volume: number): ChoBar => ({
  high,
  low,
  close,
  volume,
});
/** N identical accumulation bars (close at high → MFM +1). */
const acc = (n: number, volume = 1000) => Array.from({ length: n }, () => bar(100, 100, 98, volume));
/** N identical distribution bars (close at low → MFM −1). */
const dist = (n: number, volume = 1000) => Array.from({ length: n }, () => bar(98, 100, 98, volume));
/** N identical neutral bars (close at midpoint → MFM 0). */
const flat = (n: number, volume = 1000) => Array.from({ length: n }, () => bar(99, 100, 98, volume));

describe('adlSeries', () => {
  it('is the running cumulative sum of moneyFlowMultiplier · volume', () => {
    // close=high → MFM +1, volume 10 → ADL increments by 10 each bar.
    const s = adlSeries(Array.from({ length: 4 }, () => bar(10, 10, 0, 10)));
    expect(s).toEqual([10, 20, 30, 40]);
  });

  it('reads 0 on a flat (midpoint-close) bar', () => {
    expect(adlSeries([bar(99, 100, 98, 1000)])).toEqual([0]);
  });
});

describe('computeCho', () => {
  it('matches the hand-computed fixture (fast 2 / slow 3)', () => {
    // ADL [10,20,30,40]: EMA2 = [10,16.667,25.556,35.185], EMA3 = [10,15,22.5,31.25].
    // CHO[3] = 35.185 − 31.25 = 3.93519, CHO[2] = 25.556 − 22.5 = 3.05556 → rose → up.
    const r = computeCho(Array.from({ length: 4 }, () => bar(10, 10, 0, 10)), 2, 3)!;
    expect(r.cho).toBeCloseTo(3.9351851851, 8);
    expect(r.choNorm).toBeCloseTo(0.3935185185, 8); // ÷ avgVol 10
    expect(r.bar).toBe('up');
    expect(r.n).toBe(4);
  });

  it('is positive on accumulation and negative on distribution', () => {
    expect(computeCho(acc(40))!.choNorm).toBeGreaterThan(0);
    expect(computeCho(dist(40))!.choNorm).toBeLessThan(0);
  });

  it('reads 0 when money flow is neutral (close at the midpoint)', () => {
    expect(computeCho(flat(40))!.choNorm).toBe(0);
  });

  it('is scale-invariant under volume and price scaling', () => {
    const base = computeCho(acc(40))!.choNorm;
    const bigVol = computeCho(acc(40).map((b) => ({ ...b, volume: b.volume * 1000 })))!.choNorm;
    const bigPx = computeCho(
      acc(40).map((b) => ({ high: b.high * 7, low: b.low * 7, close: b.close * 7, volume: b.volume })),
    )!.choNorm;
    expect(bigVol).toBeCloseTo(base, 9);
    expect(bigPx).toBeCloseTo(base, 9);
  });

  it('returns null with fewer than slow + 1 bars or bad params', () => {
    expect(computeCho(acc(3), 2, 3)).toBeNull(); // need ≥ 4
    expect(computeCho([], 3, 10)).toBeNull();
    expect(computeCho(acc(40), 3, 3)).toBeNull(); // fast ≥ slow
  });
});

describe('choBoard / sortCho', () => {
  const series = [
    { symbol: 'ACC', bars: acc(40) }, // +CHO
    { symbol: 'DIS', bars: dist(40) }, // −CHO
    { symbol: 'FLT', bars: flat(40) }, // 0
  ];

  it('sorts by normalized CHO descending by default', () => {
    expect(choBoard(series, 'cho').map((r) => r.symbol)).toEqual(['ACC', 'FLT', 'DIS']);
  });

  it('sorts by symbol', () => {
    expect(choBoard(series, 'symbol').map((r) => r.symbol)).toEqual(['ACC', 'DIS', 'FLT']);
  });

  it('skips symbols with too little history', () => {
    const rows = choBoard(
      [
        { symbol: 'OK', bars: acc(40) },
        { symbol: 'THIN', bars: acc(8) },
      ],
      'cho',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortCho orders a plain row set by normalized CHO descending', () => {
    const rows = [
      { symbol: 'A', choNorm: -2 },
      { symbol: 'B', choNorm: 6 },
      { symbol: 'C', choNorm: 1 },
    ] as ChoRow[];
    expect(sortCho(rows, 'cho').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
