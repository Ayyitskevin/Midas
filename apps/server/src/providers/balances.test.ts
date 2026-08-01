import { describe, it, expect, afterEach } from 'vitest';
import { mapCcxtBalance, mapCcxtBalanceWithDiagnostics, sumValueUsd, unpricedCaveat, ccxtKeysConfigured, STABLES } from './balances';

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
    const rows = mapCcxtBalance({
      total: { BTC: 1, WIF: 100 }, free: { BTC: 1, WIF: 100 }, used: { BTC: 0, WIF: 0 },
    }, priceUsd);
    expect(rows.map((r) => r.asset)).toEqual(['BTC', 'WIF']);
    expect(rows[1].valueUsd).toBeNull();
  });

  it('drops a balance row when required free/used evidence is missing instead of zero-filling it', () => {
    expect(mapCcxtBalance({ total: { BTC: 1 }, free: { BTC: 0.4 } }, priceUsd)).toEqual([]);
    expect(mapCcxtBalance({ total: { BTC: 1 }, used: { BTC: 0.6 } }, priceUsd)).toEqual([]);
  });

  it('does not turn malformed balance or valuation fields into zero', () => {
    expect(mapCcxtBalance({
      total: { BTC: 1 }, free: { BTC: Number.NaN }, used: { BTC: 0 },
    }, priceUsd)).toEqual([]);
    expect(mapCcxtBalance({
      total: { BTC: 1 }, free: { BTC: 1 }, used: { BTC: 0 },
    }, () => 0)[0]?.valueUsd).toBeNull();
  });

  it('reports malformed held-row omissions without counting valid zero balances', () => {
    const diagnostics = mapCcxtBalanceWithDiagnostics({
      total: { BTC: 1, USDT: 10, ZRX: 0 },
      free: { BTC: 1, USDT: 10, ZRX: 0 },
      used: { USDT: 0, ZRX: 0 },
    }, priceUsd);
    expect(diagnostics).toMatchObject({ inputValid: true, attempted: 2, omitted: 1 });
    expect(diagnostics.rows.map((row) => row.asset)).toEqual(['USDT']);
    expect(mapCcxtBalanceWithDiagnostics(null, priceUsd).inputValid).toBe(false);
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

describe('unpricedCaveat', () => {
  it('is null when every held asset is priced', () => {
    expect(unpricedCaveat(mapCcxtBalance(FIXTURE, priceUsd))).toBeNull();
  });

  it('counts unpriced assets and calls the total a floor (singular and plural)', () => {
    const one = [
      { asset: 'BTC', free: 1, used: 0, total: 1, valueUsd: 60_000 },
      { asset: 'WIF', free: 100, used: 0, total: 100, valueUsd: null },
    ];
    expect(unpricedCaveat(one)).toBe(
      'Partial evidence: 1 asset could not be priced (no USDT market); the USD total is a floor.',
    );
    const two = [...one, { asset: 'POPCAT', free: 5, used: 0, total: 5, valueUsd: null }];
    expect(unpricedCaveat(two)).toBe(
      'Partial evidence: 2 assets could not be priced (no USDT market); the USD total is a floor.',
    );
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
