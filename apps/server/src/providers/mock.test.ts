import { describe, it, expect } from 'vitest';
import { mockDerivatives, mockVenueDerivatives } from './mock/derivatives';

// The mock is fully synthetic (labeled 'mock' upstream), but its funding
// intervals must be deterministic per symbol so the funding boards exercise
// 1h/4h/8h normalization the same way on every run.
describe('mock derivatives funding intervals', () => {
  it('assigns a deterministic per-symbol cadence, mostly 8h with 1h and 4h cases', async () => {
    expect((await mockDerivatives('BTC/USDT')).fundingIntervalHours).toBe(8);
    expect((await mockDerivatives('SOL/USDT')).fundingIntervalHours).toBe(1); // hourly-funding venue style
    expect((await mockDerivatives('DOGE/USDT')).fundingIntervalHours).toBe(4);
  });

  it('carries the same cadence onto every compare venue', async () => {
    const venues = await mockVenueDerivatives('SOL/USDT');
    expect(venues.length).toBeGreaterThan(0);
    for (const v of venues) expect(v.fundingIntervalHours).toBe(1);
  });

  it('aligns the next funding time to the symbol cadence boundary', async () => {
    const hourly = await mockDerivatives('SOL/USDT');
    expect(hourly.nextFundingTime).not.toBeNull();
    expect(hourly.nextFundingTime! % 3_600_000).toBe(0); // hour boundary
    expect(hourly.nextFundingTime!).toBeGreaterThan(Date.now() - 1);
    const eightHour = await mockDerivatives('BTC/USDT');
    expect(eightHour.nextFundingTime! % (8 * 3_600_000)).toBe(0);
  });

  it('stays deterministic within an hour bucket', async () => {
    const [a, b] = await Promise.all([mockDerivatives('ETH/USDT'), mockDerivatives('ETH/USDT')]);
    expect(a.fundingRate).toBe(b.fundingRate);
    expect(a.fundingIntervalHours).toBe(b.fundingIntervalHours);
    expect(a.openInterest).toBe(b.openInterest);
  });
});
