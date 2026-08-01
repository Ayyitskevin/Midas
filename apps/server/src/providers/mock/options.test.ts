import { describe, it, expect } from 'vitest';
import { provenanceNoteConsistent } from '@midas/shared';
import { MockProvider } from '../mock';

/**
 * Determinism + honesty coverage for the mock options surface (DVOL, futures
 * term structure, options chain). Synthetic fixtures must be reproducible for
 * a given instant, realistic in shape (contango, an IV smile, OI on both
 * sides) and always labeled synthetic with a caveat — never passed off as
 * Deribit data.
 */

const provider = new MockProvider();

describe('mock getDvol', () => {
  it('is deterministic within an hour and honestly labeled synthetic', async () => {
    const a = await provider.getDvol('BTC');
    const b = await provider.getDvol('BTC');
    // asOf is wall-clock; everything data-bearing is reproducible.
    const { receipt: _aReceipt, ...aData } = a;
    const { receipt: _bReceipt, ...bData } = b;
    expect({ ...aData, asOf: 0 }).toEqual({ ...bData, asOf: 0 });
    expect(a.provenance).toBe('synthetic');
    expect(a.source).toBe('mock');
    expect(provenanceNoteConsistent(a.provenance, a.note)).toBe(true);
    expect(a.note).toMatch(/synthetic/i);
  });

  it('carries a sane level and a 30-day history ending near it', async () => {
    const snap = await provider.getDvol('ETH');
    expect(snap.value).toBeGreaterThan(10);
    expect(snap.value).toBeLessThan(150);
    expect(snap.history).toHaveLength(30);
    expect(Math.abs(snap.value! - snap.history[snap.history.length - 1].value)).toBeLessThan(10);
    // BTC vols sit below ETH's in the fixture.
    const btc = await provider.getDvol('BTC');
    expect(btc.value!).toBeLessThan(snap.value! + 25);
  });
});

describe('mock getFuturesTermStructure', () => {
  it('is deterministic, contango-shaped and honestly labeled', async () => {
    const a = await provider.getFuturesTermStructure('BTC/USDT');
    const b = await provider.getFuturesTermStructure('BTC/USDT');
    const { receipt: _aReceipt, ...aData } = a;
    const { receipt: _bReceipt, ...bData } = b;
    expect({ ...aData, asOf: 0 }).toEqual({ ...bData, asOf: 0 });
    expect(a.provenance).toBe('synthetic');
    expect(provenanceNoteConsistent(a.provenance, a.note)).toBe(true);
    expect(a.underlying).toBe('BTC');
    expect(a.points.length).toBeGreaterThanOrEqual(4);
    // Nearest-first, positive basis (contango) rising with time to expiry.
    for (let i = 1; i < a.points.length; i++) {
      expect(a.points[i].expiry).toBeGreaterThan(a.points[i - 1].expiry);
    }
    for (const p of a.points) {
      expect(p.annualizedBasisPct).toBeGreaterThan(0);
      expect(p.daysToExpiry).toBeGreaterThan(0);
      expect(p.price).toBeGreaterThan(a.referencePrice!);
    }
    expect(a.points[a.points.length - 1].annualizedBasisPct).toBeGreaterThan(a.points[0].annualizedBasisPct);
    expect(a.perpPrice).toBeGreaterThan(0);
  });
});

describe('mock getOptionsChain', () => {
  it('is deterministic and honestly labeled synthetic', async () => {
    const a = await provider.getOptionsChain('BTC');
    const b = await provider.getOptionsChain('BTC');
    const { receipt: _aReceipt, ...aData } = a;
    const { receipt: _bReceipt, ...bData } = b;
    expect({ ...aData, asOf: 0 }).toEqual({ ...bData, asOf: 0 });
    expect(a.provenance).toBe('synthetic');
    expect(provenanceNoteConsistent(a.provenance, a.note)).toBe(true);
    expect(a.underlying).toBe('BTC');
  });

  it('builds a realistic chain: strikes around the money, OI both sides, IV smile, derived max pain/PCR', async () => {
    const chain = await provider.getOptionsChain('ETH/USDT');
    expect(chain.entries.length).toBeGreaterThanOrEqual(15);
    const mid = chain.underlyingPrice!;
    // Every strike carries some OI on at least one side; both sides exist overall.
    expect(chain.entries.some((e) => (e.callOi ?? 0) > 0)).toBe(true);
    expect(chain.entries.some((e) => (e.putOi ?? 0) > 0)).toBe(true);
    // Strikes bracket the money and are ascending.
    expect(chain.entries[0].strike).toBeLessThan(mid);
    expect(chain.entries[chain.entries.length - 1].strike).toBeGreaterThan(mid);
    for (let i = 1; i < chain.entries.length; i++) {
      expect(chain.entries[i].strike).toBeGreaterThan(chain.entries[i - 1].strike);
    }
    // IV smile: the average wing IV sits above the at-the-money IV.
    const atmIv = chain.entries.reduce((best, e) =>
      Math.abs(e.strike - mid) < Math.abs(best.strike - mid) ? e : best,
    ).iv!;
    const wingIv =
      chain.entries.filter((e) => Math.abs(e.strike - mid) / mid > 0.07).reduce((s, e) => s + e.iv!, 0) /
      chain.entries.filter((e) => Math.abs(e.strike - mid) / mid > 0.07).length;
    expect(wingIv).toBeGreaterThan(atmIv);
    // Max pain falls on a listed strike; PCR is a sane positive ratio.
    expect(chain.entries.some((e) => e.strike === chain.maxPainStrike)).toBe(true);
    expect(chain.putCallOiRatio).toBeGreaterThan(0);
    expect(chain.putCallOiRatio!).toBeLessThan(5);
    // ITM marks carry at least intrinsic value.
    const deepItmCall = chain.entries.find((e) => e.strike < mid * 0.9)!;
    expect(deepItmCall.callMark!).toBeGreaterThanOrEqual(mid - deepItmCall.strike);
  });

  it('honours an explicit expiry', async () => {
    const expiry = Date.now() + 14 * 86_400_000;
    const chain = await provider.getOptionsChain('BTC', expiry);
    expect(chain.expiry).toBe(expiry);
    expect(chain.entries.every((e) => e.expiry === expiry)).toBe(true);
  });
});
