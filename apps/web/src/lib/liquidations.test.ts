import { describe, it, expect } from 'vitest';
import { createDataReceipt, type LiquidationEvent, type LiquidationSourceStatus, type LiquidationsAggregateMeta } from '@midas/shared';
import {
  inspectLiquidationSources,
  inspectLiquidationsSummary,
  liquidationsFeedBadge,
  liquidationsFeedLabel,
  summarizeLiquidations,
} from '@/lib/liquidations';

const ev = (side: 'buy' | 'sell', value: number): LiquidationEvent => ({
  symbol: 'BTC/USDT',
  side,
  price: 100,
  amount: value / 100,
  value,
  timestamp: 0,
});

describe('inspectLiquidationsSummary', () => {
  const now = Date.parse('2026-08-01T12:00:00.000Z');
  const input = createDataReceipt({
    providerId: 'test',
    providerVersion: '1',
    source: 'test feed',
    datasetFamily: 'liquidations',
    provenance: 'live',
    sourceAsOf: now,
    observedAt: now,
    maxAgeMs: 10_000,
  }, now);

  it('carries formula, lineage, provenance and wall-clock freshness', () => {
    const inspected = inspectLiquidationsSummary([ev('sell', 100), ev('buy', 200)], input, now);
    expect(inspected.summary.total).toBe(300);
    expect(inspected.receipt).toMatchObject({
      derivation: 'derived',
      provenance: 'live',
      inputReceiptIds: [input.receiptId],
      freshness: { state: 'fresh', ageMs: 0 },
      methodology: { id: 'liquidation-side-summary', version: '1.0' },
    });
    expect(inspectLiquidationsSummary([], input, now + 10_001).receipt?.freshness.state).toBe('stale');
    expect(inspectLiquidationsSummary([], undefined, now).receipt).toBeNull();
  });
});

describe('summarizeLiquidations', () => {
  it('splits notional and counts by long (sell) vs short (buy)', () => {
    const s = summarizeLiquidations([ev('sell', 100), ev('sell', 50), ev('buy', 200)]);
    expect(s.longValue).toBe(150);
    expect(s.shortValue).toBe(200);
    expect(s.total).toBe(350);
    expect(s.longCount).toBe(2);
    expect(s.shortCount).toBe(1);
    expect(s.count).toBe(3);
  });

  it('is all zeros for an empty feed', () => {
    expect(summarizeLiquidations([])).toEqual({
      longValue: 0,
      shortValue: 0,
      total: 0,
      count: 0,
      longCount: 0,
      shortCount: 0,
    });
  });
});

describe('liquidationsFeedLabel — never LIVE for synthetic/mock', () => {
  it('labels synthetic demo even when available', () => {
    expect(
      liquidationsFeedLabel({ source: 'mock', available: true, synthetic: true }),
    ).toBe('demo');
  });

  it('treats source=mock without synthetic flag as demo (defense in depth)', () => {
    expect(liquidationsFeedLabel({ source: 'mock', available: true })).toBe('demo');
  });

  it('labels unavailable sources as no-feed, not live', () => {
    expect(
      liquidationsFeedLabel({
        source: 'ccxt:binance',
        available: false,
        synthetic: false,
      }),
    ).toBe('no-feed');
  });

  it('labels real available non-synthetic feeds as live', () => {
    expect(
      liquidationsFeedLabel({
        source: 'ccxt:okx',
        available: true,
        synthetic: false,
      }),
    ).toBe('live');
  });

  it('badge never uses liveTone for demo or no-feed', () => {
    const demo = liquidationsFeedBadge({
      source: 'mock',
      available: true,
      synthetic: true,
      note: 'Synthetic liquidations',
    });
    expect(demo.label).toBe('demo');
    expect(demo.liveTone).toBe(false);
    expect(demo.title).toMatch(/synthetic/i);

    const none = liquidationsFeedBadge({
      source: 'yahoo',
      available: false,
      note: 'No feed',
    });
    expect(none.label).toBe('no-feed');
    expect(none.liveTone).toBe(false);
  });
});

describe('inspectLiquidationSources', () => {
  const status = (over: Partial<LiquidationSourceStatus> & { source: string }): LiquidationSourceStatus => ({
    sampled: false,
    available: true,
    throttled: true,
    synthetic: false,
    eventCount: 0,
    lastEventAt: null,
    ageMs: null,
    stale: null,
    note: null,
    ...over,
  });

  it('returns null for a feed that carries no source set', () => {
    expect(inspectLiquidationSources(undefined)).toBeNull();
    expect(
      inspectLiquidationSources({ sources: [], coverage: { configured: 0, sampled: 0, reporting: 0, ratio: null } }),
    ).toBeNull();
  });

  it('surfaces the coverage ratio rather than summarizing it away', () => {
    const view = inspectLiquidationSources({
      sources: [
        status({ source: 'binance', available: false }),
        status({ source: 'okx', sampled: true, eventCount: 4, lastEventAt: 900, ageMs: 100, stale: false }),
        status({ source: 'kraken' }),
      ],
      coverage: { configured: 3, sampled: 1, reporting: 1, ratio: 1 / 3 },
    });
    expect(view?.coverageLabel).toBe('1 of 3 venues sampled · 1 reporting');
    expect(view?.coverageTitle).toContain('33% source coverage');
    expect(view?.coverageTitle).toMatch(/lower bound/i);
    expect(view?.partialCoverage).toBe(true);
  });

  it('maps each source state to a tone, and only proven-fresh reads go green', () => {
    const view = inspectLiquidationSources({
      sources: [
        status({ source: 'okx', sampled: true, eventCount: 4, lastEventAt: 900, ageMs: 100, stale: false }),
        status({ source: 'bybit', sampled: true, eventCount: 1, lastEventAt: 1, ageMs: 90_000, stale: true }),
        status({ source: 'kraken', sampled: true }),
        status({ source: 'kucoin', sampled: true, eventCount: 2, ageMs: -5_000, lastEventAt: 6_000 }),
        status({ source: 'binance', available: false }),
        status({ source: 'bitfinex' }),
        status({ source: 'demo', sampled: true, synthetic: true, eventCount: 9, lastEventAt: 900, ageMs: 100, stale: false }),
      ],
      coverage: { configured: 7, sampled: 5, reporting: 4, ratio: 4 / 7 },
    });
    const states = Object.fromEntries((view?.rows ?? []).map((r) => [r.source, r.state]));
    expect(states).toEqual({
      okx: 'live',
      bybit: 'stale',
      kraken: 'quiet',
      kucoin: 'skewed',
      binance: 'no feed',
      bitfinex: 'not sampled',
      demo: 'demo',
    });
    // The synthetic source reports stale:false — it must still never go green.
    const green = (view?.rows ?? []).filter((r) => r.tone === 'ok').map((r) => r.source);
    expect(green).toEqual(['okx']);
  });

  it('labels a single-venue feed without pluralizing the denominator', () => {
    const view = inspectLiquidationSources({
      sources: [status({ source: 'okx', sampled: true, eventCount: 1, lastEventAt: 0, ageMs: 5, stale: false })],
      coverage: { configured: 1, sampled: 1, reporting: 1, ratio: 1 },
    });
    expect(view?.coverageLabel).toBe('1 of 1 venue sampled · 1 reporting');
    expect(view?.partialCoverage).toBe(false);
  });

  it('reports a stale source with the age that made it stale', () => {
    const view = inspectLiquidationSources({
      sources: [status({ source: 'okx', sampled: true, eventCount: 1, lastEventAt: 0, ageMs: 120_000, stale: true })],
      coverage: { configured: 1, sampled: 1, reporting: 1, ratio: 1 },
    });
    expect(view?.rows[0].detail).toContain('2m');
  });
});

describe('inspectLiquidationSources — the aggregate multiple', () => {
  const status = (over: Partial<LiquidationSourceStatus> & { source: string }): LiquidationSourceStatus => ({
    sampled: true,
    available: true,
    throttled: true,
    synthetic: false,
    eventCount: 1,
    lastEventAt: 900,
    ageMs: 100,
    stale: false,
    note: null,
    ...over,
  });
  const view = (aggregate: LiquidationsAggregateMeta | undefined) =>
    inspectLiquidationSources({
      sources: [status({ source: 'okx' }), status({ source: 'binance' })],
      coverage: { configured: 2, sampled: 2, reporting: 2, ratio: 1 },
      aggregate,
    });

  it('phrases the multiple against one venue, never against the market', () => {
    const v = view({ totalValue: 420, referenceSource: 'binance', referenceValue: 100, multiple: 4.2 });
    expect(v?.multipleLabel).toBe('4.2x vs binance alone');
    expect(v?.multipleTitle).toMatch(/lower bound on under-reporting, not a recovered total/i);
    expect(v?.multipleTitle).toMatch(/itself throttled/i);
    // It must never claim to have recovered the documented 6-20x gap.
    expect(v?.multipleTitle).not.toMatch(/actual|true volume|complete/i);
  });

  it('rounds large multiples to a whole number and keeps small ones precise', () => {
    expect(view({ totalValue: 1, referenceSource: 'binance', referenceValue: 1, multiple: 12.7 })?.multipleLabel)
      .toBe('13x vs binance alone');
    expect(view({ totalValue: 1, referenceSource: 'binance', referenceValue: 1, multiple: 1.25 })?.multipleLabel)
      .toBe('1.3x vs binance alone');
  });

  it('says the reference venue shows none instead of hiding the finding', () => {
    // The default install: the primary venue publishes nothing at all.
    const v = view({ totalValue: 5_000, referenceSource: 'binance', referenceValue: 0, multiple: null });
    expect(v?.multipleLabel).toBe('binance alone shows none');
    expect(v?.multipleTitle).toMatch(/single-source feed would show an empty panel/i);
  });

  it('shows nothing when there is no reference or no aggregate at all', () => {
    expect(view(undefined)?.multipleLabel).toBeNull();
    expect(view({ totalValue: 100, referenceSource: null, referenceValue: null, multiple: null })?.multipleLabel)
      .toBeNull();
    expect(view({ totalValue: 0, referenceSource: 'binance', referenceValue: 0, multiple: null })?.multipleLabel)
      .toBeNull();
  });

  it('refuses a non-finite or non-positive multiple rather than rendering it', () => {
    for (const multiple of [Number.POSITIVE_INFINITY, Number.NaN, 0, -2]) {
      expect(view({ totalValue: 100, referenceSource: 'binance', referenceValue: 10, multiple })?.multipleLabel)
        .toBeNull();
    }
  });
});
