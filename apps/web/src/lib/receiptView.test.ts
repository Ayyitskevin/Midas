import { describe, expect, it } from 'vitest';
import { partialEvidenceLimitation, type DataReceipt } from '@midas/shared';
import {
  formatReceiptDuration,
  formatReceiptTime,
  isReceiptActionable,
  receiptBadgeView,
  receiptDetailRows,
} from './receiptView';

const NOW = Date.parse('2026-08-01T12:00:02.000Z');

function receipt(overrides: Partial<DataReceipt> = {}): DataReceipt {
  return {
    schemaVersion: '1.0',
    receiptId: 'rcpt-quote-btc',
    providerId: 'ccxt',
    providerVersion: '4.5.0',
    source: 'ccxt',
    venue: 'binance',
    datasetFamily: 'quote',
    instrument: 'BTC/USDT',
    coverage: 'spot',
    provenance: 'live',
    derivation: 'observed',
    sourceAsOf: '2026-08-01T12:00:00.000Z',
    observedAt: '2026-08-01T12:00:02.000Z',
    expectedCadenceMs: 5_000,
    maxAgeMs: 15_000,
    freshness: { state: 'fresh', ageMs: 2_000 },
    cache: { status: 'miss', ageMs: null },
    units: { price: 'USD' },
    methodology: null,
    inputReceiptIds: [],
    limitations: [],
    traceId: 'trace-123',
    note: null,
    ...overrides,
  } as DataReceipt;
}

describe('receiptBadgeView', () => {
  it('composes live source mode and fresh state', () => {
    expect(receiptBadgeView(receipt(), NOW)).toMatchObject({
      label: 'LIVE / FRESH',
      source: 'ccxt:binance',
      ageText: '2s',
      tone: 'fresh',
    });
  });

  it('keeps stale and derived as independent visible dimensions', () => {
    expect(
      receiptBadgeView(
        receipt({
          derivation: 'derived',
          freshness: { state: 'stale', ageMs: 90_000 },
        }),
        NOW,
      ),
    ).toMatchObject({ label: 'LIVE / STALE / DERIVED', tone: 'stale', ageText: '1m' });
  });

  it.each([
    ['synthetic', 'SYNTHETIC / DERIVED', 'synthetic'],
    ['unavailable', 'UNAVAILABLE / DERIVED', 'unavailable'],
  ] as const)('renders %s provenance honestly', (provenance, label, tone) => {
    expect(receiptBadgeView(receipt({ provenance, derivation: 'derived' }), NOW)).toMatchObject({ label, tone });
  });

  it('does not paint live data green when freshness is unknown', () => {
    expect(
      receiptBadgeView(receipt({ freshness: { state: 'unknown', ageMs: null } }), NOW),
    ).toMatchObject({ label: 'LIVE / UNKNOWN', tone: 'unknown', ageText: 'unknown' });
  });

  it('makes provider clock skew explicit and non-green', () => {
    expect(
      receiptBadgeView(receipt({ freshness: { state: 'clock-skew', ageMs: -2_000 } }), NOW),
    ).toMatchObject({ label: 'LIVE / CLOCK SKEW', tone: 'stale', ageText: '2s ahead (clock skew)' });
  });

  it('downgrades a frozen fresh receipt against wall-clock time without a new payload', () => {
    const evidence = receipt();
    expect(receiptBadgeView(evidence, NOW).tone).toBe('fresh');
    expect(receiptBadgeView(evidence, NOW + 13_001)).toMatchObject({
      label: 'LIVE / STALE',
      tone: 'stale',
      ageText: '15s',
    });
    expect(isReceiptActionable(evidence, NOW)).toBe(true);
    expect(isReceiptActionable(evidence, NOW + 13_001)).toBe(false);
    expect(isReceiptActionable(receipt({ provenance: 'synthetic' }), NOW)).toBe(false);
  });

  it('renders partial live evidence amber and never treats it as actionable', () => {
    const partial = receipt({
      limitations: [partialEvidenceLimitation('The liquidation upstream read failed.')],
    });
    expect(receiptBadgeView(partial, NOW)).toMatchObject({
      label: 'LIVE / FRESH / PARTIAL',
      tone: 'partial',
    });
    expect(isReceiptActionable(partial, NOW)).toBe(false);
  });
});

describe('receipt formatting', () => {
  it('renders timestamps in stable UTC and rejects missing or malformed values', () => {
    expect(formatReceiptTime('2026-08-01T12:00:00.000Z')).toBe('2026-08-01 12:00:00 UTC');
    expect(formatReceiptTime(null)).toBe('unknown');
    expect(formatReceiptTime('not-a-date')).toBe('unknown');
  });

  it('makes clock skew and missing ages explicit', () => {
    expect(formatReceiptDuration(-2_000)).toBe('2s ahead (clock skew)');
    expect(formatReceiptDuration(null)).toBe('unknown');
    expect(formatReceiptDuration(3_600_000)).toBe('1h');
  });

  it('keeps absent receipt evidence visible as unknown', () => {
    const rows = receiptDetailRows(
      receipt({
        venue: null,
        instrument: null,
        coverage: null,
        sourceAsOf: null,
        methodology: null,
        units: {},
        traceId: null,
      }),
      NOW,
    );
    const values = new Map(rows.map((row) => [row.label, row.value]));
    expect(values.get('Venue')).toBe('unknown');
    expect(values.get('Instrument')).toBe('unknown');
    expect(values.get('Source as-of')).toBe('unknown');
    expect(values.get('Methodology')).toBe('unknown');
    expect(values.get('Units')).toBe('unknown');
    expect(values.get('Trace ID')).toBe('unknown');
  });
});
