import { describe, it, expect } from 'vitest';
import {
  computeLiquidationSourceStatuses,
  computeLiquidationsCoverage,
  LIQUIDATION_SOURCE_MAX_AGE_MS,
  type LiquidationSourceCapability,
  type LiquidationSourceObservation,
} from '@midas/shared';
import { normalizeLiquidationsMeta } from './liquidationsHonesty';

// Frozen clock. Every staleness assertion below is measured against this
// constant, never Date.now() — a wall-clock test cannot assert a boundary flip.
const ASOF = 1_700_000_000_000;
const MAX_AGE = LIQUIDATION_SOURCE_MAX_AGE_MS;

const publishing = (source: string): LiquidationSourceCapability => ({
  source,
  available: true,
  throttled: true,
  note: 'throttled public stream',
});
const noFeed = (source: string): LiquidationSourceCapability => ({
  source,
  available: false,
  throttled: false,
  note: null,
});
const observed = (
  source: string,
  eventCount: number,
  lastEventAt: number | null,
): LiquidationSourceObservation => ({ source, eventCount, lastEventAt });

const bySource = <T extends { source: string }>(statuses: T[], source: string): T => {
  const found = statuses.find((s) => s.source === source);
  if (!found) throw new Error(`no status for ${source}`);
  return found;
};

describe('M3 — per-source staleness is measured, and its boundary is exact', () => {
  it('reports ageMs as asOf minus the newest observed event time', () => {
    const statuses = computeLiquidationSourceStatuses(
      [publishing('okx'), publishing('bybit')],
      [observed('okx', 3, ASOF - 12_000), observed('bybit', 1, ASOF - 45_000)],
      ASOF,
      MAX_AGE,
    );
    expect(bySource(statuses, 'okx').ageMs).toBe(12_000);
    expect(bySource(statuses, 'bybit').ageMs).toBe(45_000);
  });

  it('flips stale exactly at maxAgeMs — at the threshold is still fresh', () => {
    const at = computeLiquidationSourceStatuses(
      [publishing('okx')],
      [observed('okx', 1, ASOF - MAX_AGE)],
      ASOF,
      MAX_AGE,
    );
    const oneMsPast = computeLiquidationSourceStatuses(
      [publishing('okx')],
      [observed('okx', 1, ASOF - MAX_AGE - 1)],
      ASOF,
      MAX_AGE,
    );
    const oneMsShort = computeLiquidationSourceStatuses(
      [publishing('okx')],
      [observed('okx', 1, ASOF - MAX_AGE + 1)],
      ASOF,
      MAX_AGE,
    );
    expect(bySource(at, 'okx').ageMs).toBe(MAX_AGE);
    expect(bySource(at, 'okx').stale).toBe(false);
    expect(bySource(oneMsShort, 'okx').stale).toBe(false);
    expect(bySource(oneMsPast, 'okx').stale).toBe(true);
  });

  it('leaves staleness unknown rather than fresh when it cannot be known', () => {
    const statuses = computeLiquidationSourceStatuses(
      [publishing('okx'), publishing('bybit'), publishing('kraken'), noFeed('binance')],
      [
        // read, but the venue produced nothing: quiet market and dead feed are
        // indistinguishable from here.
        observed('okx', 0, null),
        // newest event is ahead of our clock — skew, never clamped to fresh.
        observed('bybit', 2, ASOF + 5_000),
        // 'kraken' absent from observations entirely: configured, not sampled.
      ],
      ASOF,
      MAX_AGE,
    );
    expect(bySource(statuses, 'okx').stale).toBeNull();
    expect(bySource(statuses, 'okx').sampled).toBe(true);
    expect(bySource(statuses, 'bybit').stale).toBeNull();
    expect(bySource(statuses, 'bybit').ageMs).toBe(-5_000);
    expect(bySource(statuses, 'kraken').stale).toBeNull();
    expect(bySource(statuses, 'kraken').sampled).toBe(false);
    expect(bySource(statuses, 'binance').stale).toBeNull();
    for (const s of statuses) expect(s.stale).not.toBe(false);
  });
});

describe('M4 — availability and throttle come from capability, never event count', () => {
  it('labels a publishing venue throttled and a no-feed venue neither', () => {
    const statuses = computeLiquidationSourceStatuses(
      [publishing('okx'), noFeed('binance')],
      [observed('okx', 9, ASOF - 1_000)],
      ASOF,
      MAX_AGE,
    );
    expect(bySource(statuses, 'okx')).toMatchObject({ available: true, throttled: true });
    expect(bySource(statuses, 'binance')).toMatchObject({ available: false, throttled: false });
  });

  it('does not downgrade a busy source or upgrade a silent one', () => {
    // Same capability, opposite event volume: the labels must not move.
    const statuses = computeLiquidationSourceStatuses(
      [publishing('okx'), publishing('bybit')],
      [observed('okx', 500, ASOF - 500), observed('bybit', 0, null)],
      ASOF,
      MAX_AGE,
    );
    expect(bySource(statuses, 'okx').throttled).toBe(true);
    expect(bySource(statuses, 'bybit').throttled).toBe(true);
  });

  it('never marks a synthetic source as a throttled upstream stream', () => {
    const statuses = computeLiquidationSourceStatuses(
      [{ source: 'mock', available: true, throttled: true, synthetic: true, note: 'demo' }],
      [observed('mock', 12, ASOF - 1_000)],
      ASOF,
      MAX_AGE,
    );
    expect(bySource(statuses, 'mock')).toMatchObject({ synthetic: true, throttled: false });
  });
});

describe('M1 — source coverage is a measured ratio over the configured set', () => {
  it('reports reporting/configured for K publishing and N-K empty venues', () => {
    const configured = ['okx', 'bybit', 'kraken', 'bitfinex', 'kucoin', 'binance'];
    const statuses = computeLiquidationSourceStatuses(
      configured.map(publishing),
      [
        observed('okx', 4, ASOF - 1_000),
        observed('bybit', 2, ASOF - 2_000),
        observed('kraken', 0, null),
        observed('bitfinex', 0, null),
      ],
      ASOF,
      MAX_AGE,
    );
    const coverage = computeLiquidationsCoverage(statuses);
    expect(coverage).toEqual({ configured: 6, sampled: 4, reporting: 2, ratio: 2 / 6 });
  });

  it('matches the single-source baseline this campaign starts from: 1 of 6', () => {
    const configured = ['binance', 'coinbase', 'kraken', 'bitfinex', 'okx', 'kucoin'];
    const statuses = computeLiquidationSourceStatuses(
      configured.map(publishing),
      [observed('binance', 7, ASOF - 3_000)],
      ASOF,
      MAX_AGE,
    );
    expect(computeLiquidationsCoverage(statuses)).toEqual({
      configured: 6,
      sampled: 1,
      reporting: 1,
      ratio: 1 / 6,
    });
  });

  it('reports zero coverage — not an omitted ratio — when no source publishes', () => {
    // The stock install: the default primary venue removed its public stream,
    // so the panel is empty while looking live. Coverage must say 0/6, loudly.
    const statuses = computeLiquidationSourceStatuses(
      [noFeed('binance'), ...['coinbase', 'kraken', 'bitfinex', 'okx', 'kucoin'].map(publishing)],
      [observed('binance', 0, null)],
      ASOF,
      MAX_AGE,
    );
    expect(computeLiquidationsCoverage(statuses)).toEqual({
      configured: 6,
      sampled: 1,
      reporting: 0,
      ratio: 0,
    });
  });

  it('has a null ratio, never a fabricated 0/0, when nothing is configured', () => {
    expect(computeLiquidationsCoverage([]).ratio).toBeNull();
  });
});

describe('sampled evidence is never silently discarded', () => {
  it('appends an observation that matches no declared capability', () => {
    const statuses = computeLiquidationSourceStatuses(
      [publishing('okx')],
      [observed('okx', 1, ASOF - 1_000), observed('hyperliquid', 5, ASOF - 2_000)],
      ASOF,
      MAX_AGE,
    );
    expect(statuses).toHaveLength(2);
    expect(bySource(statuses, 'hyperliquid')).toMatchObject({ sampled: true, eventCount: 5 });
  });

  it('matches a capability to its observation case-insensitively', () => {
    const statuses = computeLiquidationSourceStatuses(
      [publishing('OKX')],
      [observed('okx', 3, ASOF - 1_000)],
      ASOF,
      MAX_AGE,
    );
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ sampled: true, eventCount: 3 });
  });
});

describe('normalizeLiquidationsMeta — the feed always carries source coverage', () => {
  it('derives a one-entry source set for a provider that declares none', () => {
    const meta = normalizeLiquidationsMeta(
      { source: 'ccxt:okx', available: true, sampledSource: 'okx' },
      ASOF,
      [observed('okx', 4, ASOF - 1_000)],
      MAX_AGE,
    );
    expect(meta.sources).toHaveLength(1);
    expect(meta.sources[0]).toMatchObject({
      source: 'okx',
      sampled: true,
      available: true,
      throttled: true,
      stale: false,
      eventCount: 4,
    });
    expect(meta.coverage).toEqual({ configured: 1, sampled: 1, reporting: 1, ratio: 1 });
  });

  it('keeps the declared multi-venue set as the coverage denominator', () => {
    const meta = normalizeLiquidationsMeta(
      {
        source: 'ccxt:binance',
        available: false,
        sampledSource: 'binance',
        sources: [noFeed('binance'), publishing('okx'), publishing('kraken')],
      },
      ASOF,
      [],
      MAX_AGE,
    );
    expect(meta.coverage).toEqual({ configured: 3, sampled: 0, reporting: 0, ratio: 0 });
    expect(bySource(meta.sources, 'okx').note).toMatch(/not sampled/i);
    expect(bySource(meta.sources, 'binance').note).toMatch(/no public liquidation feed/i);
  });

  // M5 — the recurring bug class: synthetic data rendered as live.
  it('forces every source of a mock feed synthetic and un-throttled', () => {
    const meta = normalizeLiquidationsMeta(
      {
        source: 'mock',
        available: true,
        // A mock provider that "forgot" to label its per-source entries.
        sources: [publishing('okx'), publishing('bybit')],
      },
      ASOF,
      [observed('okx', 3, ASOF - 1_000)],
      MAX_AGE,
    );
    expect(meta.synthetic).toBe(true);
    for (const s of meta.sources) {
      expect(s.synthetic).toBe(true);
      expect(s.throttled).toBe(false);
    }
  });

  it('reports staleness for the sampled source at the frozen boundary', () => {
    const stale = normalizeLiquidationsMeta(
      { source: 'ccxt:okx', available: true, sampledSource: 'okx' },
      ASOF,
      [observed('okx', 1, ASOF - MAX_AGE - 1)],
      MAX_AGE,
    );
    expect(stale.sources[0].stale).toBe(true);
    expect(stale.asOf).toBe(ASOF);
  });
});
