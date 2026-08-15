import { describe, it, expect } from 'vitest';
import type { ScreenerRow } from '@midas/shared';
import { computeBreadth, buildOverview } from '@/lib/marketOverview';

/** Build a ScreenerRow from [symbol, changePercent, quoteVolume]. */
const rows = (xs: Array<[string, number, number]>): ScreenerRow[] =>
  xs.map(([symbol, changePercent, quoteVolume]) => ({
    symbol,
    name: symbol,
    price: 100,
    changePercent,
    volume: quoteVolume,
    quoteVolume,
  }));

describe('computeBreadth', () => {
  it('counts advancers, decliners and unchanged with the average change', () => {
    const b = computeBreadth(rows([
      ['A', 5, 1],
      ['B', -3, 1],
      ['C', 0, 1],
      ['D', 1, 1],
    ]));
    expect(b).toMatchObject({ advancers: 2, decliners: 1, unchanged: 1, total: 4 });
    expect(b.advancingPct).toBeCloseTo(0.5);
    expect(b.avgChange).toBeCloseTo(0.75); // (5 - 3 + 0 + 1) / 4
  });

  it('returns zeros for an empty set', () => {
    expect(computeBreadth([])).toEqual({
      advancers: 0,
      decliners: 0,
      unchanged: 0,
      unknown: 0,
      total: 0,
      advancingPct: 0,
      // No measured row means no mean to report — null, not a reassuring 0.
      avgChange: null,
    });
  });
});

describe('buildOverview', () => {
  const set = rows([
    ['AAA', 12, 50],
    ['BBB', -8, 900],
    ['CCC', 3, 400],
    ['DDD', -2, 100],
    ['EEE', 20, 10],
  ]);

  it('ranks gainers high→low and losers low→high', () => {
    const o = buildOverview(set, 2);
    expect(o.gainers.map((r) => r.symbol)).toEqual(['EEE', 'AAA']);
    expect(o.losers.map((r) => r.symbol)).toEqual(['BBB', 'DDD']);
  });

  it('ranks most active by quote volume', () => {
    const o = buildOverview(set, 2);
    expect(o.mostActive.map((r) => r.symbol)).toEqual(['BBB', 'CCC']);
  });

  it('does not mutate the input order', () => {
    const snapshot = set.map((r) => r.symbol);
    buildOverview(set, 3);
    expect(set.map((r) => r.symbol)).toEqual(snapshot);
  });

  it('handles an empty set', () => {
    const o = buildOverview([]);
    expect(o.gainers).toEqual([]);
    expect(o.losers).toEqual([]);
    expect(o.mostActive).toEqual([]);
    expect(o.breadth.total).toBe(0);
  });
});

// A market that reported no 24h change is not a flat market. Counting it as
// "unchanged" would let missing data masquerade as a measurement, and averaging
// it in as 0 would drag the mean toward zero for free.
describe('breadth separates unknown change from unchanged', () => {
  const row = (symbol: string, changePercent: number | null): ScreenerRow => ({
    symbol,
    name: symbol,
    price: 100,
    changePercent,
    volume: 10,
    quoteVolume: 1_000,
  });

  it('counts unreported change as unknown, not unchanged', () => {
    const b = computeBreadth([row('A/USDT', 5), row('B/USDT', null), row('C/USDT', 0)]);
    expect(b.unknown).toBe(1);
    expect(b.unchanged).toBe(1);
    expect(b.total).toBe(3);
  });

  it('excludes unknown rows from the average and the advancing ratio', () => {
    const b = computeBreadth([row('A/USDT', 10), row('B/USDT', null)]);
    // Mean over the one measured row, not 5 (= 10/2 with the unknown as zero).
    expect(b.avgChange).toBe(10);
    expect(b.advancingPct).toBe(1);
  });

  it('reports no average when every row is unknown', () => {
    const b = computeBreadth([row('A/USDT', null), row('B/USDT', null)]);
    expect(b.avgChange).toBeNull();
    expect(b.unknown).toBe(2);
    expect(b.advancingPct).toBe(0);
  });

  it('keeps unknown rows out of both mover lists', () => {
    const overview = buildOverview([row('A/USDT', 5), row('B/USDT', null), row('C/USDT', -5)]);
    // A top-gainers or top-losers board is a ranking claim; an unmeasured
    // symbol cannot support one in either direction.
    expect(overview.gainers.some((r) => r.changePercent === null)).toBe(false);
    expect(overview.losers.some((r) => r.changePercent === null)).toBe(false);
    // It still counts as real market activity for the volume ranking.
    expect(overview.mostActive.some((r) => r.symbol === 'B/USDT')).toBe(true);
  });
});
