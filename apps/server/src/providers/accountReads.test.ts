import { describe, it, expect } from 'vitest';
import { mapOpenOrders, mapPositions, sumUnrealizedPnl } from './accountReads';

describe('mapOpenOrders', () => {
  // A representative slice of a ccxt fetchOpenOrders() result.
  const FIXTURE = [
    {
      id: '101',
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'limit',
      price: 59000,
      amount: 0.5,
      filled: 0.1,
      remaining: 0.4,
      status: 'open',
      timestamp: 1700000001000,
    },
    {
      id: '102',
      symbol: 'ETH/USDT',
      side: 'sell',
      type: 'limit',
      price: 3500,
      amount: 2,
      filled: 0,
      status: 'open',
      timestamp: 1700000002000, // newer → should sort first
    },
  ];

  it('maps orders newest-first with a quote-notional value', () => {
    const rows = mapOpenOrders(FIXTURE);
    expect(rows.map((r) => r.id)).toEqual(['102', '101']); // newest first
    expect(rows[1]).toEqual({
      id: '101',
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'limit',
      price: 59000,
      amount: 0.5,
      filled: 0.1,
      remaining: 0.4,
      value: 29_500,
      timestamp: 1700000001000,
      status: 'open',
    });
  });

  it('derives remaining = amount − filled when the field is missing', () => {
    const rows = mapOpenOrders(FIXTURE);
    const eth = rows.find((r) => r.id === '102')!;
    expect(eth.remaining).toBe(2); // amount 2, filled 0
    expect(eth.value).toBe(7_000);
  });

  it('returns [] for malformed payloads (defensive)', () => {
    expect(mapOpenOrders(null)).toEqual([]);
    expect(mapOpenOrders({})).toEqual([]);
    expect(mapOpenOrders('nope')).toEqual([]);
  });
});

describe('mapPositions', () => {
  const FIXTURE = [
    {
      symbol: 'BTC/USDT:USDT',
      side: 'long',
      contracts: 0.5,
      notional: 30_000,
      entryPrice: 60_000,
      markPrice: 61_000,
      unrealizedPnl: 500,
      percentage: 1.67,
      liquidationPrice: 45_000,
      leverage: 10,
    },
    {
      symbol: 'ETH/USDT:USDT',
      side: 'short',
      contracts: -4, // ccxt may report a signed size; mapper takes the magnitude
      notional: 14_000,
      entryPrice: 3500,
      markPrice: 3450,
      unrealizedPnl: 200,
      percentage: 1.43,
      liquidationPrice: 4200,
      leverage: 5,
    },
    // flat position → dropped
    { symbol: 'SOL/USDT:USDT', side: 'long', contracts: 0, notional: 0 },
  ];

  it('maps non-flat positions, sorted by notional, with normalized side & size', () => {
    const rows = mapPositions(FIXTURE);
    expect(rows.map((r) => r.symbol)).toEqual(['BTC/USDT:USDT', 'ETH/USDT:USDT']); // SOL flat dropped
    expect(rows[1]).toEqual({
      symbol: 'ETH/USDT:USDT',
      side: 'short',
      contracts: 4, // magnitude
      notionalUsd: 14_000,
      entryPrice: 3500,
      markPrice: 3450,
      unrealizedPnlUsd: 200,
      pnlPct: 1.43,
      liquidationPrice: 4200,
      leverage: 5,
    });
  });

  it('returns [] for malformed payloads (defensive)', () => {
    expect(mapPositions(null)).toEqual([]);
    expect(mapPositions({})).toEqual([]);
  });
});

describe('sumUnrealizedPnl', () => {
  it('sums position P&L and is null when none report one', () => {
    expect(sumUnrealizedPnl(mapPositions([]))).toBeNull();
    const rows = mapPositions([
      { symbol: 'BTC/USDT:USDT', side: 'long', contracts: 1, unrealizedPnl: 500 },
      { symbol: 'ETH/USDT:USDT', side: 'short', contracts: 1, unrealizedPnl: -200 },
    ]);
    expect(sumUnrealizedPnl(rows)).toBe(300);
  });
});
