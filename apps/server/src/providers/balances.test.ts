import { describe, it, expect, afterEach } from 'vitest';
import { mapCcxtBalance, sumValueUsd, ccxtKeysConfigured, STABLES } from './balances';

// A representative slice of a ccxt fetchBalance() result. ccxt stamps `free`,
// `used` and `total` dicts plus per-asset objects and an `info` blob; the mapper
// reads the `total`/`free`/`used` dicts and ignores the rest.
const FIXTURE = {
  free: { BTC: 0.5, USDT: 1000, ETH: 2, ZRX: 0 },
  used: { BTC: 0.1, USDT: 0, ETH: 0, ZRX: 0 },
  total: { BTC: 0.6, USDT: 1000, ETH: 2, ZRX: 0 },
  BTC: { free: 0.5, used: 0.1, total: 0.6 },
  info: {},
};

const PRICES: Record<string, number> = { BTC: 60_000, ETH: 3_000 };
const priceUsd = (a: string) => (STABLES.has(a) ? 1 : PRICES[a] ?? null);

describe('mapCcxtBalance', () => {
  it('maps positive balances, prices them, and sorts by USD value', () => {
    const rows = mapCcxtBalance(FIXTURE, priceUsd);
    expect(rows.map((r) => r.asset)).toEqual(['BTC', 'ETH', 'USDT']); // ZRX (0) dropped
    expect(rows[0]).toEqual({ asset: 'BTC', free: 0.5, used: 0.1, total: 0.6, valueUsd: 36_000 });
    expect(rows[1]).toEqual({ asset: 'ETH', free: 2, used: 0, total: 2, valueUsd: 6_000 });
    expect(rows[2]).toEqual({ asset: 'USDT', free: 1000, used: 0, total: 1000, valueUsd: 1_000 });
  });

  it('leaves an unpriced asset with a null value and sinks it to the bottom', () => {
    const rows = mapCcxtBalance({ total: { BTC: 1, WIF: 100 }, free: { BTC: 1, WIF: 100 } }, priceUsd);
    expect(rows.map((r) => r.asset)).toEqual(['BTC', 'WIF']);
    expect(rows[1].valueUsd).toBeNull();
  });

  it('falls back to used = total − free when the used dict is missing', () => {
    const rows = mapCcxtBalance({ total: { BTC: 1 }, free: { BTC: 0.4 } }, priceUsd);
    expect(rows[0].free).toBe(0.4);
    expect(rows[0].used).toBeCloseTo(0.6);
  });

  it('returns [] for malformed/empty payloads (defensive)', () => {
    expect(mapCcxtBalance({}, priceUsd)).toEqual([]);
    expect(mapCcxtBalance({ total: 'nope' }, priceUsd)).toEqual([]);
    expect(mapCcxtBalance(null, priceUsd)).toEqual([]);
  });
});

describe('sumValueUsd', () => {
  it('sums priced balances and ignores unpriced ones', () => {
    expect(sumValueUsd(mapCcxtBalance(FIXTURE, priceUsd))).toBe(43_000);
  });

  it('is null when nothing can be priced', () => {
    expect(sumValueUsd([{ asset: 'WIF', free: 1, used: 0, total: 1, valueUsd: null }])).toBeNull();
  });
});

describe('ccxtKeysConfigured', () => {
  const key = process.env.MIDAS_CCXT_API_KEY;
  const secret = process.env.MIDAS_CCXT_SECRET;
  afterEach(() => {
    if (key === undefined) delete process.env.MIDAS_CCXT_API_KEY;
    else process.env.MIDAS_CCXT_API_KEY = key;
    if (secret === undefined) delete process.env.MIDAS_CCXT_SECRET;
    else process.env.MIDAS_CCXT_SECRET = secret;
  });

  it('is true only when both the key and secret are present', () => {
    delete process.env.MIDAS_CCXT_API_KEY;
    delete process.env.MIDAS_CCXT_SECRET;
    expect(ccxtKeysConfigured()).toBe(false);
    process.env.MIDAS_CCXT_API_KEY = 'k';
    expect(ccxtKeysConfigured()).toBe(false); // secret still missing
    process.env.MIDAS_CCXT_SECRET = 's';
    expect(ccxtKeysConfigured()).toBe(true);
  });
});
