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
      total: 0,
      advancingPct: 0,
      avgChange: 0,
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
