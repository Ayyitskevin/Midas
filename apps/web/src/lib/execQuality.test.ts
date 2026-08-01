import { describe, it, expect } from 'vitest';
import { createDataReceipt, type AccountFill } from '@midas/shared';
import { computeExecQuality, inspectExecQuality } from './execQuality';
import type { FillBaseline } from './postTradeSlippage';

const fill = (over: Partial<AccountFill>): AccountFill => ({
  id: 'f1',
  orderId: null,
  symbol: 'BTC/USDT',
  side: 'buy',
  price: 100,
  amount: 1,
  cost: 100,
  fee: null,
  feeCurrency: null,
  takerOrMaker: null,
  timestamp: 0,
  ...over,
});

const baseline = (orderId: string, estPrice: number): FillBaseline => ({
  orderId,
  symbol: 'BTC/USDT',
  side: 'buy',
  estPrice,
  at: 0,
});

describe('computeExecQuality', () => {
  it('handles an empty tape', () => {
    const q = computeExecQuality([], {});
    expect(q.fills).toBe(0);
    expect(q.makerPct).toBeNull();
    expect(q.avgSlipBps).toBeNull();
    expect(q.slipCoveragePct).toBe(0);
    expect(q.bySymbol).toEqual([]);
  });

  it('computes maker %, fee groups and per-symbol notional ordering', () => {
    const q = computeExecQuality(
      [
        fill({ id: 'a', takerOrMaker: 'maker', fee: 0.1, feeCurrency: 'USDT' }),
        fill({ id: 'b', takerOrMaker: 'taker', fee: 0.2, feeCurrency: 'USDT' }),
        fill({ id: 'c', takerOrMaker: 'maker', fee: 0.001, feeCurrency: 'BNB' }),
        fill({ id: 'd', symbol: 'ETH/USDT', cost: 500 }), // no M/T label → excluded from maker %
      ],
      {},
    );
    expect(q.fills).toBe(4);
    expect(q.notional).toBe(800);
    expect(q.makerPct).toBeCloseTo((2 / 3) * 100);
    expect(q.feeTotals).toEqual([
      { currency: 'USDT', total: 0.30000000000000004 },
      { currency: 'BNB', total: 0.001 },
    ]);
    expect(q.bySymbol[0].symbol).toBe('ETH/USDT'); // larger notional first
  });

  it('weights slippage by notional and reports honest coverage', () => {
    const baselines = { o1: baseline('o1', 100), o2: baseline('o2', 100) };
    const q = computeExecQuality(
      [
        fill({ id: 'a', orderId: 'o1', price: 101, cost: 100 }), // +100bp on 100
        fill({ id: 'b', orderId: 'o2', price: 100.5, cost: 300 }), // +50bp on 300
        fill({ id: 'c', orderId: null, cost: 600 }), // uncovered
      ],
      baselines,
    );
    expect(q.avgSlipBps).toBeCloseTo((100 * 100 + 50 * 300) / 400); // 62.5
    expect(q.slipCoveragePct).toBeCloseTo(40); // 400 of 1000 notional covered
    const btc = q.bySymbol.find((s) => s.symbol === 'BTC/USDT');
    expect(btc?.avgSlipBps).toBeCloseTo(62.5);
  });

  it('groups unknown fee currencies under ? and leaves uncovered symbols null', () => {
    const q = computeExecQuality([fill({ fee: 0.5, feeCurrency: null })], {});
    expect(q.feeTotals).toEqual([{ currency: '?', total: 0.5 }]);
    expect(q.bySymbol[0].avgSlipBps).toBeNull();
  });
});

describe('inspectExecQuality', () => {
  const now = Date.parse('2026-08-01T12:00:00.000Z');
  const input = createDataReceipt({
    providerId: 'test-account',
    providerVersion: '1',
    source: 'test fills',
    datasetFamily: 'account-fills',
    instrument: 'BTC/USDT',
    provenance: 'live',
    sourceAsOf: now,
    observedAt: now,
    maxAgeMs: 30_000,
  }, now);

  it('receipts fill-only aggregates while explicitly excluding local slippage', () => {
    const inspected = inspectExecQuality(
      [fill({ orderId: 'o1', timestamp: now })],
      { o1: baseline('o1', 99) },
      input,
      now,
    );
    expect(inspected.quality.avgSlipBps).not.toBeNull();
    expect(inspected.receipt).toMatchObject({
      derivation: 'derived',
      provenance: 'live',
      inputReceiptIds: [input.receiptId],
      freshness: { state: 'fresh', ageMs: 0 },
      methodology: { id: 'execution-quality-fill-aggregates', version: '1.0' },
    });
    expect(inspected.receipt?.limitations.join(' ')).toMatch(/slippage.*not covered/i);
    expect(inspectExecQuality([], {}, undefined, now).receipt).toBeNull();
  });
});
