import { describe, expect, it } from 'vitest';
import { createDataReceipt, type VenueQuote } from '@midas/shared';
import { computeInspectedVenueArb, isActionableVenueArb } from './clientArb';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function quote(
  exchange: string,
  bid: number,
  ask: number,
  receipt = true,
  provenance: 'live' | 'synthetic' = 'live',
): VenueQuote {
  return {
    exchange,
    bid,
    ask,
    bidSize: 2,
    askSize: 2,
    price: (bid + ask) / 2,
    changePercent: 0,
    volume: null,
    timestamp: NOW,
    ...(receipt
      ? {
          receipt: createDataReceipt(
            {
              providerId: provenance === 'synthetic' ? 'mock' : `ccxt:${exchange.toLowerCase()}`,
              providerVersion: 'test',
              source: exchange,
              venue: exchange,
              datasetFamily: 'venue-quotes',
              instrument: 'BTC/USDT',
              provenance,
              sourceAsOf: NOW,
              observedAt: NOW,
              expectedCadenceMs: 5_000,
              maxAgeMs: 30_000,
              units: { price: 'USDT', size: 'BTC' },
              limitations: provenance === 'synthetic' ? ['Synthetic venue quote fixture.'] : [],
              note: provenance === 'synthetic' ? 'Synthetic venue quote fixture.' : null,
            },
            NOW,
          ),
        }
      : {}),
  };
}

describe('computeInspectedVenueArb', () => {
  it('creates inspectable derived lineage for a fresh net spread', () => {
    const result = computeInspectedVenueArb(
      'BTC/USDT',
      [quote('Binance', 102, 103), quote('OKX', 99, 100)],
      NOW,
    );
    expect(result.row.netCrossed).toBe(true);
    expect(result.receipt?.derivation).toBe('derived');
    expect(result.receipt?.inputReceiptIds).toHaveLength(2);
    expect(result.row.receipt?.receiptId).toBe(result.receipt?.receiptId);
    expect(result.actionable).toBe(true);
  });

  it('suppresses an unreceipted net signal', () => {
    const result = computeInspectedVenueArb(
      'BTC/USDT',
      [quote('Binance', 102, 103), quote('OKX', 99, 100, false)],
      NOW,
    );
    expect(result.row.netSpreadBps).toBeNull();
    expect(result.row.netCrossed).toBe(false);
    expect(result.receipt).toBeNull();
    expect(result.actionable).toBe(false);
    expect(result.row.netLimitations.join(' ')).toMatch(/source receipts/i);
  });

  it('keeps a synthetic net spread illustrative and non-actionable', () => {
    const result = computeInspectedVenueArb(
      'BTC/USDT',
      [quote('Binance', 102, 103, true, 'synthetic'), quote('OKX', 99, 100, true, 'synthetic')],
      NOW,
    );
    expect(result.receipt?.provenance).toBe('synthetic');
    expect(result.row.netCrossed).toBe(true);
    expect(result.actionable).toBe(false);
    expect(isActionableVenueArb(result.row)).toBe(false);
  });
});
