import { describe, expect, it } from 'vitest';
import { createDataReceipt, type Candle } from '@midas/shared';
import { inspectChartCalculations, type ChartStudySelection } from './chartTrust';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const candles: Candle[] = [
  { time: NOW / 1_000 - 60, open: 100, high: 102, low: 99, close: 100, volume: 10 },
  { time: NOW / 1_000, open: 100, high: 112, low: 100, close: 110, volume: 20 },
];
const studies: ChartStudySelection = {
  sma: true,
  ema: false,
  bb: false,
  vwap: true,
  rsi: false,
  macd: true,
  vp: false,
};
const input = createDataReceipt({
  providerId: 'test-history',
  providerVersion: '1',
  source: 'test history',
  datasetFamily: 'history',
  instrument: 'BTC/USDT',
  coverage: '1m/1d',
  provenance: 'live',
  sourceAsOf: NOW,
  observedAt: NOW,
  maxAgeMs: 30_000,
}, NOW);

describe('inspectChartCalculations', () => {
  it('receipts active formulas and source lineage with conservative freshness', () => {
    const inspected = inspectChartCalculations(candles, input, 'BTC/USDT', '1m', '1d', studies, NOW);
    expect(inspected.performance).toEqual({ first: 100, last: 110, percent: 10 });
    expect(inspected.receipt).toMatchObject({
      derivation: 'derived',
      provenance: 'live',
      inputReceiptIds: [input.receiptId],
      freshness: { state: 'fresh', ageMs: 0 },
      methodology: { id: 'chart-analytics', version: '1.0' },
    });
    expect(inspected.receipt?.coverage).toContain('active=sma,vwap,macd');
    expect(inspected.receipt?.methodology?.formula).toMatch(/SMA20.*VWAP.*MACD/);
    expect(inspectChartCalculations(candles, input, 'BTC/USDT', '1m', '1d', studies, NOW + 30_001).receipt?.freshness.state)
      .toBe('stale');
  });

  it('keeps calculations illustrative when source lineage is missing', () => {
    const inspected = inspectChartCalculations(candles, undefined, 'BTC/USDT', '1m', '1d', studies, NOW);
    expect(inspected.performance?.percent).toBe(10);
    expect(inspected.receipt).toBeNull();
  });
});
