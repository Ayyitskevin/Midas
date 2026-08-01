import { describe, it, expect } from 'vitest';
import { computeBasis } from '@/lib/basis';

describe('computeBasis', () => {
  it('computes a positive basis and premium when the perp trades over spot', () => {
    const s = computeBasis({ markPrice: 100.5, indexPrice: 100, fundingRate: 0.0001, fundingIntervalHours: 8 });
    expect(s.valid).toBe(true);
    expect(s.basis).toBeCloseTo(0.5);
    expect(s.premiumPct).toBeCloseTo(0.5);
    expect(s.fundingAprPct).toBeCloseTo(0.0001 * 1095 * 100); // ≈ 10.95%
  });

  it('computes a negative basis when the perp trades under spot', () => {
    const s = computeBasis({ markPrice: 99, indexPrice: 100, fundingRate: -0.0002, fundingIntervalHours: 8 });
    expect(s.basis).toBeCloseTo(-1);
    expect(s.premiumPct).toBeCloseTo(-1);
    expect(s.fundingAprPct).toBeCloseTo(-0.0002 * 1095 * 100);
  });

  it('annualizes from the actual funding interval (1h is 8x the 8h APR)', () => {
    const hourly = computeBasis({ markPrice: 100, indexPrice: 100, fundingRate: 0.0001, fundingIntervalHours: 1 });
    expect(hourly.fundingAprPct).toBeCloseTo(0.0001 * 8760 * 100); // 87.6%
    const fourHour = computeBasis({ markPrice: 100, indexPrice: 100, fundingRate: 0.0001, fundingIntervalHours: 4 });
    expect(fourHour.fundingAprPct).toBeCloseTo(0.0001 * 2190 * 100); // 21.9%
  });

  it('returns a null APR when the funding interval is unknown — never assumes 8h', () => {
    const unknown = computeBasis({ markPrice: 100, indexPrice: 100, fundingRate: 0.0001 });
    expect(unknown.fundingAprPct).toBeNull();
    const explicitNull = computeBasis({ markPrice: 100, indexPrice: 100, fundingRate: 0.0001, fundingIntervalHours: null });
    expect(explicitNull.fundingAprPct).toBeNull();
  });

  it('honours a custom fundings-per-year, taking precedence over the interval', () => {
    const s = computeBasis({ markPrice: 100, indexPrice: 100, fundingRate: 0.0001, fundingsPerYear: 8760 });
    expect(s.fundingAprPct).toBeCloseTo(0.0001 * 8760 * 100); // hourly funding
    const both = computeBasis({
      markPrice: 100,
      indexPrice: 100,
      fundingRate: 0.0001,
      fundingsPerYear: 8760,
      fundingIntervalHours: 8,
    });
    expect(both.fundingAprPct).toBeCloseTo(0.0001 * 8760 * 100);
  });

  it('is invalid when mark or index is missing or non-positive', () => {
    expect(computeBasis({ markPrice: null, indexPrice: 100, fundingRate: 0 }).valid).toBe(false);
    expect(computeBasis({ markPrice: 100, indexPrice: 0, fundingRate: 0 }).valid).toBe(false);
    const s = computeBasis({ markPrice: null, indexPrice: null, fundingRate: null });
    expect(s.basis).toBeNull();
    expect(s.premiumPct).toBeNull();
    expect(s.fundingAprPct).toBeNull();
  });

  it('still annualizes funding when prices are absent, given a known interval', () => {
    const s = computeBasis({ markPrice: null, indexPrice: null, fundingRate: 0.0001, fundingIntervalHours: 8 });
    expect(s.valid).toBe(false);
    expect(s.fundingAprPct).toBeCloseTo(10.95);
  });
});
