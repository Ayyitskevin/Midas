import { describe, it, expect } from 'vitest';
import {
  classifyOiDelta,
  isOiDeltaWindow,
  pctChange,
  summarizeOiDelta,
  type OiDeltaPoint,
} from '@midas/shared';

/**
 * Coverage for the shared OI-delta positioning math (the pure helpers in
 * packages/shared/src/oiDelta.ts): the four ΔOI × Δprice quadrants, the null /
 * flat cases that must never be guessed at, and the series summarizer every
 * provider assembles its payload through. Same pattern as optionsMath.test.ts —
 * plain fixtures, no provider, no network.
 */

describe('classifyOiDelta', () => {
  it('maps the four ΔOI × Δprice quadrants to their positioning reads', () => {
    expect(classifyOiDelta(5, 2)).toBe('long-buildup'); // OI↑ + price↑
    expect(classifyOiDelta(5, -2)).toBe('short-buildup'); // OI↑ + price↓
    expect(classifyOiDelta(-5, -2)).toBe('long-unwind'); // OI↓ + price↓
    expect(classifyOiDelta(-5, 2)).toBe('short-covering'); // OI↓ + price↑
  });

  it('is null when either change is unknown — never guessed', () => {
    expect(classifyOiDelta(null, 2)).toBeNull();
    expect(classifyOiDelta(5, null)).toBeNull();
    expect(classifyOiDelta(null, null)).toBeNull();
    expect(classifyOiDelta(Number.NaN, 2)).toBeNull();
    expect(classifyOiDelta(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('is null on an exactly flat side — a 0% change is no buildup and no direction', () => {
    expect(classifyOiDelta(0, 2)).toBeNull();
    expect(classifyOiDelta(5, 0)).toBeNull();
    expect(classifyOiDelta(0, 0)).toBeNull();
  });
});

describe('pctChange', () => {
  it('computes the signed percent change', () => {
    expect(pctChange(105, 100)).toBeCloseTo(5, 10);
    expect(pctChange(95, 100)).toBeCloseTo(-5, 10);
  });

  it('is null for missing or non-positive evidence — never a fabricated percent', () => {
    expect(pctChange(null, 100)).toBeNull();
    expect(pctChange(105, null)).toBeNull();
    expect(pctChange(105, 0)).toBeNull();
    expect(pctChange(105, -10)).toBeNull();
    expect(pctChange(Number.NaN, 100)).toBeNull();
  });
});

describe('isOiDeltaWindow', () => {
  it('accepts only the whitelisted windows', () => {
    for (const w of ['1h', '4h', '24h', '7d']) expect(isOiDeltaWindow(w)).toBe(true);
    for (const w of ['', '2h', '1d', '24H', '24hours', '1h; DROP TABLE']) {
      expect(isOiDeltaWindow(w)).toBe(false);
    }
  });
});

describe('summarizeOiDelta', () => {
  const series: OiDeltaPoint[] = [
    { timestamp: 1_000, openInterestAmount: null, openInterestValue: 100_000, price: 50_000 },
    { timestamp: 2_000, openInterestAmount: null, openInterestValue: 110_000, price: 51_000 },
    { timestamp: 3_000, openInterestAmount: null, openInterestValue: 121_000, price: 53_040 },
  ];

  it('reduces an aligned series to the endpoints, changes and quadrant', () => {
    const s = summarizeOiDelta(series);
    expect(s.oiBasis).toBe('notional');
    expect(s.oiThen).toBe(100_000);
    expect(s.oiNow).toBe(121_000);
    expect(s.oiChangePct).toBeCloseTo(21, 10);
    expect(s.priceChangePct).toBeCloseTo(6.08, 5);
    expect(s.classification).toBe('long-buildup');
    expect(s.asOf).toBe(3_000);
  });

  it('prefers contract-denominated OI — a flat-position rally is no buildup', () => {
    // Positions are FLAT in contracts across a +10% rally; the notional leg
    // drifts +10% purely from price. The old notional-only read called this
    // 'long-buildup' — on the contracts basis the OI change is exactly flat
    // and the quadrant is honestly null.
    const s = summarizeOiDelta([
      { timestamp: 1_000, openInterestAmount: 10_000, openInterestValue: 500_000_000, price: 50_000 },
      { timestamp: 2_000, openInterestAmount: 10_000, openInterestValue: 550_000_000, price: 55_000 },
    ]);
    expect(s.oiBasis).toBe('contracts');
    expect(s.oiThen).toBe(10_000);
    expect(s.oiNow).toBe(10_000);
    expect(s.oiChangePct).toBe(0);
    expect(s.priceChangePct).toBeCloseTo(10, 10);
    expect(s.classification).toBeNull();
  });

  it('falls back to notional and labels the basis when contracts are unreported', () => {
    // Same market as above with only the notional leg reported: the price
    // drift DOES produce a quadrant here, and the basis label is what keeps
    // the caveat visible.
    const s = summarizeOiDelta([
      { timestamp: 1_000, openInterestAmount: null, openInterestValue: 500_000_000, price: 50_000 },
      { timestamp: 2_000, openInterestAmount: null, openInterestValue: 550_000_000, price: 55_000 },
    ]);
    expect(s.oiBasis).toBe('notional');
    expect(s.oiChangePct).toBeCloseTo(10, 10);
    expect(s.classification).toBe('long-buildup');
  });

  it('is all-null when neither contracts nor notional evidence exists', () => {
    const s = summarizeOiDelta([
      { timestamp: 1_000, openInterestAmount: null, openInterestValue: null, price: 50_000 },
      { timestamp: 2_000, openInterestAmount: null, openInterestValue: null, price: 55_000 },
    ]);
    expect(s.oiBasis).toBeNull();
    expect(s.oiThen).toBeNull();
    expect(s.oiNow).toBeNull();
    expect(s.oiChangePct).toBeNull();
    expect(s.classification).toBeNull();
    expect(s.asOf).toBe(2_000);
  });

  it('never mixes bases across endpoints — a contracts-then vs notional-now is null', () => {
    const s = summarizeOiDelta([
      { timestamp: 1_000, openInterestAmount: 10_000, openInterestValue: null, price: 50_000 },
      { timestamp: 2_000, openInterestAmount: null, openInterestValue: 550_000_000, price: 55_000 },
    ]);
    expect(s.oiBasis).toBeNull();
    expect(s.oiThen).toBeNull();
    expect(s.oiNow).toBeNull();
    expect(s.oiChangePct).toBeNull();
    expect(s.classification).toBeNull();
  });

  it('requires prices at the exact OI endpoints instead of shortening the window', () => {
    const s = summarizeOiDelta([
      { timestamp: 1_000, openInterestAmount: null, openInterestValue: 100_000, price: null },
      { timestamp: 2_000, openInterestAmount: null, openInterestValue: 90_000, price: 50_000 },
      { timestamp: 3_000, openInterestAmount: null, openInterestValue: 80_000, price: 49_000 },
      { timestamp: 4_000, openInterestAmount: null, openInterestValue: 75_000, price: null },
    ]);
    expect(s.oiBasis).toBe('notional');
    expect(s.oiChangePct).toBeCloseTo(-25, 10);
    expect(s.priceChangePct).toBeNull();
    expect(s.classification).toBeNull();
    expect(s.asOf).toBe(4_000);
  });

  it('reports nulls off a single point — a delta off one observation is fabrication', () => {
    const s = summarizeOiDelta([
      { timestamp: 1_000, openInterestAmount: 10_000, openInterestValue: 100_000, price: 50_000 },
    ]);
    expect(s.oiBasis).toBe('contracts');
    expect(s.oiThen).toBe(10_000);
    expect(s.oiNow).toBeNull();
    expect(s.oiChangePct).toBeNull();
    expect(s.priceChangePct).toBeNull();
    expect(s.classification).toBeNull();
    expect(s.asOf).toBe(1_000);
  });

  it('reports all-null off an empty series', () => {
    const s = summarizeOiDelta([]);
    expect(s).toEqual({
      oiBasis: null,
      oiNow: null,
      oiThen: null,
      oiChangePct: null,
      priceChangePct: null,
      classification: null,
      asOf: null,
    });
  });
});
