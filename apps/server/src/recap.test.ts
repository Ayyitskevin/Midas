import { describe, it, expect } from 'vitest';
import type { AccountFill, EquityPoint, Quote } from '@midas/shared';
import { composeRecap, equityChange, fillRecap, recapLines, topMovers } from './recap';
import { buildDigestText } from './digest';

const HOUR = 3_600_000;

const pt = (at: number, totalUsd: number): EquityPoint => ({ at, totalUsd, unrealizedPnlUsd: null });

describe('equityChange', () => {
  const series = [pt(1 * HOUR, 100), pt(2 * HOUR, 110), pt(26 * HOUR, 130), pt(27 * HOUR, 125)];

  it('baselines at the last snapshot at/before the period start', () => {
    const c = equityChange(series, 2 * HOUR, 28 * HOUR);
    expect(c).toEqual({ startUsd: 110, endUsd: 125, startAt: 2 * HOUR, endAt: 27 * HOUR });
  });

  it('falls back to the first snapshot inside the period when none precede it', () => {
    const c = equityChange(series, 0, 28 * HOUR);
    expect(c?.startUsd).toBe(100);
    expect(c?.endUsd).toBe(125);
  });

  it('is null when the series cannot speak for the period', () => {
    expect(equityChange([], 0, HOUR)).toBeNull();
    // Only one snapshot, taken before the period: nothing new → no claim.
    expect(equityChange([pt(HOUR, 100)], 2 * HOUR, 3 * HOUR)).toBeNull();
    // Snapshots exist but all after nowMs (clock skew) → ignored.
    expect(equityChange([pt(5 * HOUR, 100), pt(6 * HOUR, 110)], 0, HOUR)).toBeNull();
  });
});

const fill = (over: Partial<AccountFill>): AccountFill => ({
  id: '1',
  orderId: null,
  symbol: 'BTC/USDT',
  side: 'buy',
  price: 100,
  amount: 1,
  cost: 100,
  fee: null,
  feeCurrency: null,
  takerOrMaker: null,
  timestamp: 1000,
  ...over,
});

describe('fillRecap', () => {
  it('totals activity and fees within the window only', () => {
    const r = fillRecap(
      [
        fill({ id: 'a', side: 'buy', cost: 200, fee: 0.2, feeCurrency: 'USDT', timestamp: 1000 }),
        fill({ id: 'b', side: 'sell', cost: 150, fee: 0.1, feeCurrency: 'USDT', timestamp: 2000 }),
        fill({ id: 'c', side: 'buy', cost: 999, timestamp: 50 }), // before window
        fill({ id: 'd', side: 'buy', cost: 999, timestamp: 99_999 }), // after window
      ],
      500,
      5000,
    );
    expect(r?.count).toBe(2);
    expect(r?.buyNotionalUsd).toBe(200);
    expect(r?.sellNotionalUsd).toBe(150);
    expect(r?.feesByCurrency).toEqual({ USDT: 0.30000000000000004 });
  });

  it('FIFO-matches a long round trip and prices it ex-fees', () => {
    const r = fillRecap(
      [
        fill({ id: 'a', side: 'buy', price: 100, amount: 2, cost: 200, timestamp: 1000 }),
        fill({ id: 'b', side: 'sell', price: 110, amount: 1, cost: 110, timestamp: 2000 }),
      ],
      0,
      5000,
    );
    // 1 unit bought at 100, sold at 110 → +10; the other unit stays open (no claim).
    expect(r?.roundTripPnlUsd).toBe(10);
  });

  it('matches short-first round trips and multiple lots in order', () => {
    const r = fillRecap(
      [
        fill({ id: 'a', side: 'sell', price: 120, amount: 1, cost: 120, timestamp: 1000 }),
        fill({ id: 'b', side: 'sell', price: 110, amount: 1, cost: 110, timestamp: 1500 }),
        fill({ id: 'c', side: 'buy', price: 100, amount: 2, cost: 200, timestamp: 2000 }),
      ],
      0,
      5000,
    );
    // Shorts at 120 and 110 both covered at 100 → +20 +10.
    expect(r?.roundTripPnlUsd).toBe(30);
  });

  it('never matches across symbols and reports null with no round trips', () => {
    const r = fillRecap(
      [
        fill({ id: 'a', symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1, timestamp: 1000 }),
        fill({ id: 'b', symbol: 'ETH/USDT', side: 'sell', price: 110, amount: 1, timestamp: 2000 }),
      ],
      0,
      5000,
    );
    expect(r?.roundTripPnlUsd).toBeNull();
  });

  it('counts untimed fills honestly instead of guessing their period', () => {
    const r = fillRecap([fill({ id: 'a', timestamp: null })], 0, 5000);
    expect(r?.count).toBe(0);
    expect(r?.untimed).toBe(1);
  });

  it('is null when there is nothing at all to report', () => {
    expect(fillRecap([], 0, 5000)).toBeNull();
    expect(fillRecap([fill({ timestamp: 9999999 })], 0, 5000)).toBeNull();
  });
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

describe('topMovers', () => {
  it('sorts by absolute move and caps the list', () => {
    const movers = topMovers([quote('A', 1), quote('B', -9), quote('C', 4), quote('D', -2)], 3);
    expect(movers.map((m) => m.symbol)).toEqual(['B', 'C', 'D']);
  });
});

describe('recapLines + digest rendering', () => {
  it('renders equity, fills and movers lines with honest ≈ markers', () => {
    const lines = recapLines({
      equity: { startUsd: 10_000, endUsd: 10_450, startAt: 0, endAt: 1 },
      fills: {
        count: 12,
        buyNotionalUsd: 8200,
        sellNotionalUsd: 9100,
        feesByCurrency: { USDT: 1.23 },
        roundTripPnlUsd: 412.5,
        untimed: 0,
      },
      movers: [
        { symbol: 'SOL/USDT', changePercent: 8.2 },
        { symbol: 'BTC/USDT', changePercent: -1.9 },
      ],
    });
    expect(lines[0]).toBe('• Equity: $10,000 → $10,450 (+$450, +4.50%)');
    expect(lines[1]).toBe('• Fills: 12 (bought ≈$8,200, sold ≈$9,100) · round-trip P&L ≈+$412.5 (ex-fees) · fees 1.23 USDT');
    expect(lines[2]).toBe('• Movers (your positions): SOL/USDT +8.20% · BTC/USDT −1.90%');
  });

  it('omits sections that are null and notes untimed fills', () => {
    const lines = recapLines({
      equity: null,
      fills: { count: 0, buyNotionalUsd: 0, sellNotionalUsd: 0, feesByCurrency: {}, roundTripPnlUsd: null, untimed: 2 },
      movers: null,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Fills: 0');
    expect(lines[1]).toContain('2 fills without timestamps excluded');
  });

  it('places equity above alerts and the detail lines after order flow in the digest', () => {
    const text = buildDigestText({
      sinceMs: 0,
      nowMs: 86_400_000,
      providerName: 'ccxt:binance',
      providerLive: true,
      version: '0.4.0',
      alertsFired: 2,
      events: [],
      missedEvents: 0,
      watching: true,
      recap: {
        equity: { startUsd: 100, endUsd: 90, startAt: 0, endAt: 1 },
        fills: null,
        movers: [{ symbol: 'BTC/USDT', changePercent: -3 }],
      },
    });
    const lines = text.split('\n');
    expect(lines[1]).toBe('• Equity: $100 → $90 (−$10, −10.00%)');
    expect(lines[2]).toBe('• Alerts fired: 2');
    expect(lines[4]).toBe('• Movers (your positions): BTC/USDT −3.00%');
  });
});

describe('composeRecap', () => {
  const livePositions = {
    source: 'test',
    provenance: 'live' as const,
    note: null,
    positions: [
      {
        symbol: 'SOL/USDT',
        side: 'long' as const,
        contracts: 1,
        notionalUsd: null,
        entryPrice: null,
        markPrice: null,
        unrealizedPnlUsd: null,
        pnlPct: null,
        liquidationPrice: null,
        leverage: null,
      },
    ],
    totalUnrealizedPnlUsd: null,
    asOf: 0,
  };

  it('assembles sections from provider reads and equity points', async () => {
    const provider = {
      getFills: async () => ({
        source: 'test',
        provenance: 'live' as const,
        note: null,
        fills: [fill({ timestamp: 1000, cost: 100 })],
        asOf: 0,
      }),
      getPositions: async () => livePositions,
      getQuote: async (s: string) => quote(s, 5),
    };
    const r = await composeRecap(
      provider as never,
      () => [pt(100, 1000), pt(2000, 1100)],
      500,
      5000,
    );
    expect(r.equity?.startUsd).toBe(1000);
    expect(r.fills?.count).toBe(1);
    expect(r.movers).toEqual([{ symbol: 'SOL/USDT', changePercent: 5 }]);
  });

  it('omits sections independently: non-live reads and thrown reads yield nulls', async () => {
    const provider = {
      getFills: async () => ({ source: 'test', provenance: 'synthetic' as const, note: 'demo', fills: [fill({})], asOf: 0 }),
      getPositions: async () => {
        throw new Error('down');
      },
      getQuote: async (s: string) => quote(s, 5),
    };
    const r = await composeRecap(provider as never, null, 0, 5000);
    expect(r).toEqual({ equity: null, fills: null, movers: null });
  });

  it('does nothing at all without a provider', async () => {
    const r = await composeRecap(null, null, 0, 5000);
    expect(r).toEqual({ equity: null, fills: null, movers: null });
  });
});
