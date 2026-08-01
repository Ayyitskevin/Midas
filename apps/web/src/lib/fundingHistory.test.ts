import { describe, it, expect } from 'vitest';
import { inspectFundingSummary, summarizeFunding } from '@/lib/fundingHistory';
import { createDataReceipt, type FundingHistoryPoint } from '@midas/shared';

const pt = (
  time: number,
  fundingRate: number | null,
  fundingIntervalHours: number | null = 8,
): FundingHistoryPoint => ({ time, fundingRate, fundingIntervalHours });

describe('summarizeFunding', () => {
  it('is all-null for an empty / unusable series', () => {
    expect(summarizeFunding([])).toMatchObject({ count: 0, current: null, averageApr: null, positiveShare: 0 });
    expect(summarizeFunding([pt(1, null)]).count).toBe(0);
  });

  it('computes current, average, range and APR (8h cadence → ×1095)', () => {
    const s = summarizeFunding([pt(1, 0.0001), pt(2, -0.0001), pt(3, 0.0002)]);
    expect(s.count).toBe(3);
    expect(s.current).toBeCloseTo(0.0002, 9);
    expect(s.average).toBeCloseTo(0.0000666667, 9);
    expect(s.min).toBeCloseTo(-0.0001, 9);
    expect(s.max).toBeCloseTo(0.0002, 9);
    // 0.0002 × (24/8) × 365 × 100 = 21.9%
    expect(s.currentApr).toBeCloseTo(21.9, 6);
    expect(s.averageApr).toBeCloseTo((0.0002 / 3) * 1095 * 100, 6);
    expect(s.positiveShare).toBeCloseTo(2 / 3, 9);
  });

  it('respects a non-8h interval and skips null rates', () => {
    const s = summarizeFunding([pt(1, 0.0001), pt(2, null), pt(3, 0.0003)], 1);
    expect(s.count).toBe(2); // null dropped
    expect(s.current).toBeCloseTo(0.0003, 9);
    // 1h cadence → ×24×365 = 8760
    expect(s.currentApr).toBeCloseTo(0.0003 * 8760 * 100, 6);
  });

  it('withholds APR when cadence is missing or mixed', () => {
    expect(summarizeFunding([pt(1, 0.0001, null), pt(2, 0.0002, null)])).toMatchObject({
      intervalHours: null,
      currentApr: null,
      averageApr: null,
    });
    expect(summarizeFunding([pt(1, 0.0001, 1), pt(2, 0.0002, 8)])).toMatchObject({
      intervalHours: null,
      currentApr: null,
    });
  });

  it('retains every used point receipt in a versioned derived summary', () => {
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    const points = [now - 28_800_000, now].map((time, index) => ({
      ...pt(time, 0.0001 * (index + 1)),
      receipt: createDataReceipt(
        {
          providerId: 'fixture',
          providerVersion: '1.0.0',
          source: 'fixture',
          venue: 'test-venue',
          datasetFamily: 'funding-history',
          instrument: 'BTC/USDT',
          provenance: 'live',
          sourceAsOf: time,
          observedAt: now,
          expectedCadenceMs: 28_800_000,
          maxAgeMs: 57_600_000,
          units: { fundingRate: 'fraction per settlement' },
        },
        now,
      ),
    }));
    const inspected = inspectFundingSummary(points, 'BTC/USDT', now);
    expect(inspected.receipt).toMatchObject({
      derivation: 'derived',
      methodology: { id: 'funding-history-summary', version: '1.0' },
      inputReceiptIds: points.map((point) => point.receipt.receiptId),
    });
    expect(inspected.receipt?.freshness.state).toBe('fresh');
  });
});
