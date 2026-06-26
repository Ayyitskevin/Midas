import { describe, it, expect } from 'vitest';
import { drawdownDeviation, computeBurke, burkeBoard, sortBurke } from './burke';
import { mean } from './distribution';
import { toReturns } from './correlation';

describe('drawdownDeviation', () => {
  it('is the root-SUM-square of the episode troughs, not their mean', () => {
    // 100→90 (−10%) recovers, then 100→80 (−20%) recovers: two distinct episodes.
    const closes = [100, 90, 100, 80, 100];
    // √(0.1² + 0.2²) = √0.05 ≈ 0.2236, NOT √(0.05/2) (RMS) and NOT 0.15 (avg).
    expect(drawdownDeviation(closes)).toBeCloseTo(Math.sqrt(0.05), 10);
  });

  it('is zero for a monotonically rising or flat series', () => {
    expect(drawdownDeviation([100, 110, 120, 130])).toBe(0);
    expect(drawdownDeviation([100, 100, 100])).toBe(0);
    expect(drawdownDeviation([])).toBe(0);
  });

  it('with one episode equals that episode trough depth', () => {
    // single dip to −50% and back: √(0.5²) = 0.5
    expect(drawdownDeviation([100, 50, 100])).toBeCloseTo(0.5, 12);
  });
});

describe('computeBurke', () => {
  it('computes an exact clean case (ppy=1)', () => {
    // closes 100→50→100: returns [−0.5, +1.0] → mean 0.25; one −50% episode.
    const r = computeBurke([100, 50, 100], 1)!;
    expect(r.annReturn).toBeCloseTo(0.25, 12);
    expect(r.ddDeviation).toBeCloseTo(0.5, 12);
    expect(r.burke).toBeCloseTo(0.5, 12); // 0.25 ÷ 0.5
    expect(r.episodes).toBe(1);
    expect(r.maxDD).toBeCloseTo(0.5, 12);
    expect(r.n).toBe(2);
  });

  it('matches the burke = annReturn ÷ ddDeviation identity for two episodes', () => {
    const closes = [100, 90, 100, 80, 100];
    const r = computeBurke(closes, 1)!;
    const expectedAnn = mean(toReturns(closes)); // ppy = 1
    const expectedDD = Math.sqrt(0.1 * 0.1 + 0.2 * 0.2);
    expect(r.annReturn).toBeCloseTo(expectedAnn, 12);
    expect(r.ddDeviation).toBeCloseTo(expectedDD, 10);
    expect(r.burke).toBeCloseTo(expectedAnn / expectedDD, 10);
    expect(r.episodes).toBe(2);
    // root-sum-square of two episodes exceeds the deepest single trough (0.2)
    expect(r.ddDeviation).toBeGreaterThan(r.maxDD);
  });

  it('returns a null Burke (and zero deviation) when the name never drew down', () => {
    const r = computeBurke([100, 110, 120, 130], 1)!;
    expect(r.ddDeviation).toBe(0);
    expect(r.burke).toBeNull();
    expect(r.episodes).toBe(0);
    expect(r.annReturn).toBeGreaterThan(0);
  });

  it('returns null with fewer than three closes', () => {
    expect(computeBurke([100, 90], 252)).toBeNull();
    expect(computeBurke([100], 252)).toBeNull();
    expect(computeBurke([], 252)).toBeNull();
  });

  it('scales annReturn and Burke linearly with periods/year, deviation unchanged', () => {
    const a = computeBurke([100, 50, 100], 1)!;
    const b = computeBurke([100, 50, 100], 252)!;
    expect(b.annReturn).toBeCloseTo(a.annReturn * 252, 9);
    expect(b.ddDeviation).toBeCloseTo(a.ddDeviation, 12); // denominator is annualization-free
    expect(b.burke).toBeCloseTo(a.burke! * 252, 9);
  });
});

describe('burkeBoard / sortBurke', () => {
  const series = [
    { symbol: 'WIN', closes: [100, 50, 100] }, // burke +0.5
    { symbol: 'FLAT', closes: [100, 110, 120] }, // no drawdown → burke null
    { symbol: 'LAG', closes: [100, 50, 60] }, // ann −0.15 ÷ 0.5 → burke −0.3
    { symbol: 'SHORT', closes: [100, 90] }, // <3 closes → filtered out
  ];

  it('filters short series, ranks by Burke desc, sinks null to the bottom', () => {
    const board = burkeBoard(series, 1);
    expect(board.map((r) => r.symbol)).toEqual(['WIN', 'LAG', 'FLAT']);
    expect(board.find((r) => r.symbol === 'FLAT')!.burke).toBeNull();
    expect(board.find((r) => r.symbol === 'WIN')!.burke).toBeCloseTo(0.5, 10);
    expect(board.find((r) => r.symbol === 'LAG')!.burke).toBeCloseTo(-0.3, 10);
  });

  it('sorts by symbol alphabetically', () => {
    const board = burkeBoard(series, 1);
    expect(sortBurke(board, 'symbol').map((r) => r.symbol)).toEqual(['FLAT', 'LAG', 'WIN']);
  });

  it('sorts by drawdown deviation, most risk first', () => {
    const board = sortBurke(burkeBoard(series, 1), 'ddDeviation');
    // WIN & LAG both have a single −50% episode (0.5); FLAT has 0 → last.
    expect(board[board.length - 1].symbol).toBe('FLAT');
    expect(board[0].ddDeviation).toBeCloseTo(0.5, 10);
  });
});
