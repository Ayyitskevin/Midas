import { describe, expect, it } from 'vitest';
import type { AccountFill, AccountPosition, EquityPoint, Quote } from '@midas/shared';
import { composeRecapEvidence } from '../recap';

const point = (at: number, totalUsd: number, unrealizedPnlUsd: number | null): EquityPoint => ({
  at,
  totalUsd,
  unrealizedPnlUsd,
});

const fill = (over: Partial<AccountFill> = {}): AccountFill => ({
  id: 'fill-1',
  orderId: 'order-1',
  symbol: 'BTC/USDT',
  side: 'buy',
  price: 100,
  amount: 1,
  cost: 100,
  fee: null,
  feeCurrency: null,
  takerOrMaker: null,
  timestamp: 1_000,
  ...over,
});

const position = (symbol: string): AccountPosition => ({
  symbol,
  side: 'long',
  contracts: 1,
  notionalUsd: null,
  entryPrice: null,
  markPrice: null,
  unrealizedPnlUsd: null,
  pnlPct: null,
  liquidationPrice: null,
  leverage: null,
});

const quote = (symbol: string, changePercent: number): Quote => ({
  symbol,
  name: symbol,
  currency: 'USD',
  exchange: 'test',
  marketState: 'REGULAR',
  price: 100,
  previousClose: 100,
  open: null,
  dayHigh: null,
  dayLow: null,
  change: 0,
  changePercent,
  volume: null,
  marketCap: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  asOf: 0,
});

describe('digest recap evidence states', () => {
  it('marks every section unavailable when no account evidence exists', async () => {
    const result = await composeRecapEvidence(null, null, 0, 5_000);

    expect(result).toEqual({
      recap: { equity: null, fills: null, movers: null },
      state: { equity: 'unavailable', fills: 'unavailable', movers: 'unavailable' },
    });
  });

  it('distinguishes live empty fills and positions from unavailable evidence', async () => {
    const provider = {
      getFills: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        fills: [],
        asOf: 5_000,
      }),
      getPositions: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        positions: [],
        totalUnrealizedPnlUsd: 0,
        asOf: 5_000,
      }),
      getQuote: async (symbol: string) => quote(symbol, 1),
    };

    const result = await composeRecapEvidence(
      provider as never,
      () => [point(500, 100, 0), point(4_000, 110, 5)],
      1_000,
      5_000,
    );

    expect(result.recap.equity).toMatchObject({ startUsd: 100, endUsd: 110 });
    expect(result.recap.fills).toBeNull();
    expect(result.recap.movers).toBeNull();
    expect(result.state).toEqual({ equity: 'available', fills: 'empty', movers: 'empty' });
  });

  it('marks wallet-only equity, untimed fills, and incomplete quotes as partial', async () => {
    const provider = {
      getFills: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        fills: [fill({ timestamp: 2_000 }), fill({ id: 'untimed', timestamp: null })],
        asOf: 5_000,
      }),
      getPositions: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        positions: [position('BTC/USDT'), position('ETH/USDT')],
        totalUnrealizedPnlUsd: null,
        asOf: 5_000,
      }),
      getQuote: async (symbol: string) => {
        if (symbol === 'ETH/USDT') throw new Error('quote unavailable');
        return quote(symbol, -4);
      },
    };

    const result = await composeRecapEvidence(
      provider as never,
      () => [point(500, 100, null), point(4_000, 105, 5)],
      1_000,
      5_000,
    );

    expect(result.recap.fills).toMatchObject({ count: 1, untimed: 1 });
    expect(result.recap.movers).toEqual([{ symbol: 'BTC/USDT', changePercent: -4 }]);
    expect(result.state).toEqual({ equity: 'partial', fills: 'partial', movers: 'partial' });
  });

  it('does not turn live-but-limited empty account reads into evidence of none', async () => {
    const provider = {
      getFills: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: 'A secondary venue was unavailable.',
        fills: [],
        asOf: 5_000,
      }),
      getPositions: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        receipt: { limitations: ['Partial evidence: malformed position rows were omitted.'] },
        positions: [],
        totalUnrealizedPnlUsd: null,
        asOf: 5_000,
      }),
      getQuote: async (symbol: string) => quote(symbol, 1),
    };

    const result = await composeRecapEvidence(
      provider as never,
      // Both points are inside the window, so the equity change is useful but
      // cannot claim full-window coverage.
      () => [point(2_000, 100, 0), point(4_000, 110, 1)],
      1_000,
      5_000,
    );

    expect(result.recap).toMatchObject({ fills: null, movers: null });
    expect(result.state).toEqual({ equity: 'partial', fills: 'partial', movers: 'partial' });
  });

  it('does not turn synthetic, unavailable, or failed reads into empty or zero-valued claims', async () => {
    const provider = {
      getFills: async () => ({
        source: 'mock',
        provenance: 'synthetic' as const,
        note: 'demo',
        fills: [fill()],
        asOf: 5_000,
      }),
      getPositions: async () => ({
        source: 'test',
        provenance: 'unavailable' as const,
        note: 'upstream unavailable',
        positions: [position('BTC/USDT')],
        totalUnrealizedPnlUsd: 0,
        asOf: 5_000,
      }),
      getQuote: async (symbol: string) => quote(symbol, 99),
    };

    const result = await composeRecapEvidence(provider as never, () => [], 0, 5_000);

    expect(result.recap).toEqual({ equity: null, fills: null, movers: null });
    expect(result.state).toEqual({ equity: 'unavailable', fills: 'unavailable', movers: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('99');
  });

  it('keeps independent provider failures unavailable without rejecting the digest composition', async () => {
    const provider = {
      getFills: async () => {
        throw new Error('fill credential detail');
      },
      getPositions: async () => {
        throw new Error('position credential detail');
      },
      getQuote: async (symbol: string) => quote(symbol, 1),
    };

    await expect(composeRecapEvidence(provider as never, null, 0, 5_000)).resolves.toEqual({
      recap: { equity: null, fills: null, movers: null },
      state: { equity: 'unavailable', fills: 'unavailable', movers: 'unavailable' },
    });
  });

  it('marks movers partial when the bounded quote set omits live positions', async () => {
    const symbols = Array.from({ length: 9 }, (_, index) => `S${index}/USDT`);
    const provider = {
      getFills: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        fills: [],
        asOf: 5_000,
      }),
      getPositions: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        positions: symbols.map(position),
        totalUnrealizedPnlUsd: 0,
        asOf: 5_000,
      }),
      getQuote: async (symbol: string) => quote(symbol, Number(symbol.slice(1).split('/')[0])),
    };

    const result = await composeRecapEvidence(provider as never, null, 0, 5_000);

    expect(result.state.movers).toBe('partial');
    expect(result.recap.movers).toEqual([
      { symbol: 'S7/USDT', changePercent: 7 },
      { symbol: 'S6/USDT', changePercent: 6 },
      { symbol: 'S5/USDT', changePercent: 5 },
    ]);
    expect(result.recap.movers).not.toContainEqual(expect.objectContaining({ symbol: 'S8/USDT' }));
  });
});
