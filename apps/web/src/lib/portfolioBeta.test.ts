import { describe, it, expect } from 'vitest';
import { portfolioBeta, type PBetaInput } from './portfolioBeta';

describe('portfolioBeta', () => {
  it('sums beta-weighted exposure for a long book', () => {
    const inputs: PBetaInput[] = [
      { symbol: 'ETH/USDT', signedNotional: 10000, beta: 1.2 },
      { symbol: 'SOL/USDT', signedNotional: 5000, beta: 0.8 },
    ];
    const p = portfolioBeta(inputs);
    expect(p.netExposure).toBe(15000);
    expect(p.grossExposure).toBe(15000);
    expect(p.btcEquivalent).toBeCloseTo(16000, 6); // 12000 + 4000
    expect(p.betaToNet).toBeCloseTo(16000 / 15000, 9);
    expect(p.pricedCount).toBe(2);
    // Sorted by |betaWeighted| — ETH (12000) ahead of SOL (4000).
    expect(p.rows.map((r) => r.symbol)).toEqual(['ETH/USDT', 'SOL/USDT']);
    expect(p.rows[0].weight).toBeCloseTo(0.75, 9);
    expect(p.rows[1].weight).toBeCloseTo(0.25, 9);
  });

  it('lets beta weighting flip the sign versus raw net notional', () => {
    const p = portfolioBeta([
      { symbol: 'BTC/USDT', signedNotional: 10000, beta: 1.0 },
      { symbol: 'ETH/USDT', signedNotional: -8000, beta: 1.5 },
    ]);
    // Dollar-net-long (+2000) but BTC-beta-weighted net-short (−2000).
    expect(p.netExposure).toBe(2000);
    expect(p.grossExposure).toBe(18000);
    expect(p.btcEquivalent).toBeCloseTo(-2000, 6);
    expect(p.betaToNet).toBeCloseTo(-1, 9);
    expect(p.rows[0].symbol).toBe('ETH/USDT'); // |−12000| > |10000|
  });

  it('counts but excludes positions with no beta', () => {
    const p = portfolioBeta([
      { symbol: 'ETH/USDT', signedNotional: 10000, beta: 1.0 },
      { symbol: 'WIF/USDT', signedNotional: 5000, beta: null },
    ]);
    expect(p.netExposure).toBe(15000);
    expect(p.grossExposure).toBe(15000);
    expect(p.btcEquivalent).toBeCloseTo(10000, 6);
    expect(p.pricedCount).toBe(1);
    expect(p.betaMissing).toBe(1);
    expect(p.rows).toHaveLength(1);
  });

  it('ignores zero and non-finite notionals', () => {
    const p = portfolioBeta([
      { symbol: 'A/USDT', signedNotional: 0, beta: 1 },
      { symbol: 'B/USDT', signedNotional: NaN, beta: 1 },
      { symbol: 'C/USDT', signedNotional: 5000, beta: 1 },
    ]);
    expect(p.netExposure).toBe(5000);
    expect(p.grossExposure).toBe(5000);
    expect(p.rows).toHaveLength(1);
  });

  it('returns a flat NaN-beta result for an empty book', () => {
    const p = portfolioBeta([]);
    expect(p.netExposure).toBe(0);
    expect(p.grossExposure).toBe(0);
    expect(p.btcEquivalent).toBe(0);
    expect(Number.isNaN(p.betaToNet)).toBe(true);
    expect(p.rows).toHaveLength(0);
  });
});
