// @vitest-environment jsdom
// Render tests for the liquidations provenance badge/banner: a synthetic feed
// must read 'demo' and a source with no liquidation stream must read
// 'no feed' — never live. api.liquidations is mocked; navigate is stubbed so
// the command registry isn't pulled in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { createDataReceipt, partialEvidenceLimitation, type LiquidationsFeed } from '@midas/shared';
import type { PanelState } from '@/store/usePanels';
import { LiquidationsModule } from './LiquidationsModule';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const liquidationsMock = vi.hoisted(() => vi.fn<() => Promise<LiquidationsFeed>>());
vi.mock('@/lib/api', () => ({ api: { liquidations: liquidationsMock } }));
vi.mock('@/commands/execute', () => ({ navigate: vi.fn() }));

const PANEL: PanelState = {
  id: 'l1',
  module: 'LIQS',
  symbol: null,
  title: 'Liquidations',
  x: 0,
  y: 0,
  w: 5,
  h: 11,
  minW: 4,
  minH: 6,
};

beforeEach(() => liquidationsMock.mockReset());
afterEach(cleanup);

describe('LiquidationsModule provenance', () => {
  it('labels a synthetic feed as demo and shows the caveat banner', async () => {
    liquidationsMock.mockResolvedValue({
      events: [
        { symbol: 'BTC/USDT', side: 'sell', price: 50_000, amount: 0.5, value: 25_000, timestamp: Date.now() },
      ],
      meta: {
        source: 'mock',
        available: true,
        synthetic: true,
        note: 'Synthetic demo liquidations — not a live feed.',
        asOf: Date.now(),
        sources: [
          { source: 'mock', sampled: true, available: true, throttled: false, synthetic: true, eventCount: 1, lastEventAt: Date.now(), ageMs: 0, stale: false, note: 'demo' },
        ],
        coverage: { configured: 1, sampled: 1, reporting: 1, ratio: 1 },
      },
    });
    render(createElement(LiquidationsModule, { panel: PANEL }));
    expect(await screen.findByText('LIQUIDATIONS')).toBeTruthy();
    expect(screen.getAllByText('mock').length).toBeGreaterThan(0);
    expect(screen.getByText('· demo')).toBeTruthy();
    expect(screen.getByText(/Synthetic demo liquidations/)).toBeTruthy();
    // The synthetic event still renders as a row — labeled, never hidden.
    expect(screen.getByText('BTC/USDT')).toBeTruthy();
    expect(screen.queryByText('· live')).toBeNull();
  });

  it('labels a source with no liquidation feed and explains the empty state', async () => {
    liquidationsMock.mockResolvedValue({
      events: [],
      meta: {
        source: 'binance',
        available: false,
        note: 'This source publishes no public liquidation feed.',
        asOf: Date.now(),
        sources: [
          { source: 'binance', sampled: false, available: false, throttled: false, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
        ],
        coverage: { configured: 1, sampled: 0, reporting: 0, ratio: 0 },
      },
    });
    render(createElement(LiquidationsModule, { panel: PANEL }));
    expect(await screen.findByText('· no feed')).toBeTruthy();
    expect(screen.getByText(/no public liquidation feed/)).toBeTruthy();
    expect(screen.getByText(/connect an exchange that does/)).toBeTruthy();
    expect(screen.queryByText('· live')).toBeNull();
    expect(screen.queryByText(/LONG\s+\$0/)).toBeNull();
    expect(screen.queryByText(/\$0\s+SHORT/)).toBeNull();
  });

  it('labels a real feed as live without the amber caveat', async () => {
    liquidationsMock.mockResolvedValue({
      events: [
        { symbol: 'ETH/USDT', side: 'buy', price: 3_000, amount: 2, value: 6_000, timestamp: Date.now() },
      ],
      meta: {
        source: 'bybit',
        available: true,
        asOf: Date.now(),
        sources: [
          { source: 'bybit', sampled: true, available: true, throttled: true, synthetic: false, eventCount: 1, lastEventAt: Date.now(), ageMs: 0, stale: false, note: null },
        ],
        coverage: { configured: 1, sampled: 1, reporting: 1, ratio: 1 },
      },
    });
    render(createElement(LiquidationsModule, { panel: PANEL }));
    expect(await screen.findByText('· live · freshness unknown')).toBeTruthy();
    expect(screen.getAllByText('bybit').length).toBeGreaterThan(0);
    expect(screen.getByText('ETH/USDT')).toBeTruthy();
  });

  it('does not turn an empty partial read into a zero-liquidations claim', async () => {
    const now = Date.now();
    const receipt = createDataReceipt({
      providerId: 'test',
      providerVersion: '1',
      source: 'test-liquidations',
      datasetFamily: 'liquidations',
      provenance: 'live',
      derivation: 'derived',
      sourceAsOf: now,
      observedAt: now,
      maxAgeMs: 60_000,
      methodology: { id: 'test-feed', version: '1', formula: 'merge events' },
      inputReceiptIds: [`dr_${'a'.repeat(32)}`],
      limitations: [partialEvidenceLimitation('The liquidation event read failed.')],
    }, now);
    liquidationsMock.mockResolvedValue({
      events: [],
      receipt,
      meta: {
        source: 'test-liquidations',
        available: true,
        note: 'Public feed may be incomplete.',
        asOf: now,
        receipt,
        sources: [
          { source: 'test-liquidations', sampled: true, available: true, throttled: true, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
        ],
        coverage: { configured: 1, sampled: 1, reporting: 0, ratio: 0 },
      },
    });

    render(createElement(LiquidationsModule, { panel: PANEL }));
    expect(await screen.findByRole('button', { name: /LIVE \/ FRESH \/ PARTIAL \/ DERIVED/i })).toBeTruthy();
    expect(screen.getByText(/partial; no complete event result can be asserted/i)).toBeTruthy();
    expect(screen.queryByText(/LONG\s+\$0/)).toBeNull();
    expect(screen.queryByText(/\$0\s+SHORT/)).toBeNull();
  });
  it('shows how many configured venues the feed actually reads', async () => {
    const now = Date.now();
    liquidationsMock.mockResolvedValue({
      events: [
        { symbol: 'BTC/USDT', side: 'sell', price: 50_000, amount: 0.5, value: 25_000, timestamp: now },
      ],
      meta: {
        source: 'ccxt:binance',
        available: true,
        note: 'Exchange liquidation streams are throttled.',
        asOf: now,
        sampledSource: 'binance',
        // The stock install: one venue read out of six configured, and the one
        // read is the venue that removed its public stream.
        sources: [
          { source: 'binance', sampled: true, available: false, throttled: false, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
          { source: 'okx', sampled: false, available: true, throttled: true, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
          { source: 'kraken', sampled: false, available: true, throttled: true, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
          { source: 'bitfinex', sampled: false, available: true, throttled: true, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
          { source: 'kucoin', sampled: false, available: true, throttled: true, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
          { source: 'coinbase', sampled: false, available: true, throttled: true, synthetic: false, eventCount: 0, lastEventAt: null, ageMs: null, stale: null, note: null },
        ],
        coverage: { configured: 6, sampled: 1, reporting: 0, ratio: 0 },
      },
    });
    render(createElement(LiquidationsModule, { panel: PANEL }));
    expect(await screen.findByText(/1 of 6 venues sampled · 0 reporting/)).toBeTruthy();
    expect(screen.getByText('no feed')).toBeTruthy();
    expect(screen.getAllByText('not sampled')).toHaveLength(5);
    // Events render, but nothing in the source strip claims a live venue.
    expect(screen.getByText('BTC/USDT')).toBeTruthy();
    expect(screen.queryByText('live')).toBeNull();
  });

  it('never paints a synthetic source with the live tone', async () => {
    const now = Date.now();
    liquidationsMock.mockResolvedValue({
      events: [
        { symbol: 'BTC/USDT', side: 'sell', price: 50_000, amount: 0.5, value: 25_000, timestamp: now },
      ],
      meta: {
        source: 'demo',
        available: true,
        synthetic: true,
        note: 'Synthetic demo liquidations — not a live feed.',
        asOf: now,
        sources: [
          { source: 'demo', sampled: true, available: true, throttled: false, synthetic: true, eventCount: 1, lastEventAt: now, ageMs: 0, stale: false, note: 'demo' },
        ],
        coverage: { configured: 1, sampled: 1, reporting: 1, ratio: 1 },
      },
    });
    render(createElement(LiquidationsModule, { panel: PANEL }));
    // stale:false would read as 'live' for a real venue; synthetic wins.
    expect(await screen.findByText('demo', { selector: 'span.text-term-dim' })).toBeTruthy();
    expect(screen.queryByText('live')).toBeNull();
  });
});
