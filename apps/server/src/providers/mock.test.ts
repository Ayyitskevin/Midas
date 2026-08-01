import { describe, it, expect } from 'vitest';
import { MockProvider } from './mock';
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

// The demo book must behave like a real account under the cancel-only
// posture: a cancel removes the order from the open-orders fixture, and an
// unknown or already-canceled id is an honest error — never a claimed cancel.
describe('MockProvider.cancelOrder (hermetic demo cancel)', () => {
  it('cancels a fixture order and removes it from the open-orders list', async () => {
    const p = new MockProvider();
    const before = await p.getOpenOrders();
    const target = before.orders[0];
    expect(target).toBeDefined();

    await expect(p.cancelOrder(target.id, target.symbol)).resolves.toEqual({
      id: target.id,
      symbol: target.symbol,
      status: 'canceled',
    });

    const after = await p.getOpenOrders();
    expect(after.orders.map((o) => o.id)).not.toContain(target.id);
    expect(after.orders.length).toBe(before.orders.length - 1);
  });

  it('rejects an unknown id honestly (409, no claimed cancel)', async () => {
    const p = new MockProvider();
    await expect(p.cancelOrder('not-a-demo-order', 'BTC/USDT')).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/no longer open/),
    });
  });

  it('a repeated cancel of the same id is an honest 409', async () => {
    const p = new MockProvider();
    const target = (await p.getOpenOrders()).orders[0];
    await p.cancelOrder(target.id, target.symbol);
    await expect(p.cancelOrder(target.id, target.symbol)).rejects.toMatchObject({ statusCode: 409 });
  });
});
