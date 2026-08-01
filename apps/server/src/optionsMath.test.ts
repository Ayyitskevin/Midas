import { describe, it, expect } from 'vitest';
import {
  annualizedBasisPct,
  computeMaxPainStrike,
  computePutCallOiRatio,
  provenanceNoteConsistent,
  type DvolSnapshot,
  type OptionsChain,
  type OptionsChainEntry,
  type TermStructure,
} from '@midas/shared';

/**
 * Coverage for the shared options / DVOL / term-structure math (the pure
 * helpers in packages/shared/src/options.ts) and the provenance contract the
 * envelopes follow. Same pattern as the venue-board shared compute tests
 * (fundingDispersion.test.ts, venueArb.test.ts): the math lives in
 * @midas/shared and is exercised here against plain fixtures — no provider,
 * no network.
 */

const strike = (
  k: number,
  callOi: number | null = 0,
  putOi: number | null = 0,
): Pick<OptionsChainEntry, 'strike' | 'callOi' | 'putOi'> => ({ strike: k, callOi, putOi });

describe('annualizedBasisPct', () => {
  it('computes contango as a positive annualized percent', () => {
    // 2% over spot with 73 days to expiry → 2% × 365/73 = 10% annualized.
    expect(annualizedBasisPct(102, 100, 73)).toBeCloseTo(10, 10);
  });

  it('computes backwardation as a negative annualized percent', () => {
    expect(annualizedBasisPct(98, 100, 365)).toBeCloseTo(-2, 10);
  });

  it('is null for non-positive or missing evidence — never a fabricated basis', () => {
    expect(annualizedBasisPct(null, 100, 30)).toBeNull();
    expect(annualizedBasisPct(102, null, 30)).toBeNull();
    expect(annualizedBasisPct(102, 100, null)).toBeNull();
    expect(annualizedBasisPct(0, 100, 30)).toBeNull();
    expect(annualizedBasisPct(102, 0, 30)).toBeNull();
    expect(annualizedBasisPct(102, 100, 0)).toBeNull(); // expired
    expect(annualizedBasisPct(102, 100, -3)).toBeNull(); // expired
    expect(annualizedBasisPct(Number.NaN, 100, 30)).toBeNull();
  });
});

describe('computeMaxPainStrike', () => {
  it('picks the strike minimizing total intrinsic payout', () => {
    // OI clustered at 100 on both sides pulls max pain to 100; the wings only
    // raise pain at the edges.
    const entries = [strike(90, 10, 10), strike(100, 1000, 1000), strike(110, 10, 10)];
    // pain(90)  = puts: 1000·10 + 10·20 = 10200
    // pain(100) = calls: 10·10; puts: 10·10 → 200
    // pain(110) = calls: 10·20 + 1000·10 = 10200
    expect(computeMaxPainStrike(entries)).toBe(100);
  });

  it('returns null when any contributing strike has missing OI', () => {
    const entries = [strike(90, null, null), strike(100, 400, null), strike(110, null, 400)];
    expect(computeMaxPainStrike(entries)).toBeNull();
  });

  it('is null when no strike carries any OI — never a strike off empty evidence', () => {
    expect(computeMaxPainStrike([])).toBeNull();
    expect(computeMaxPainStrike([strike(100, null, null), strike(110, 0, 0)])).toBeNull();
  });
});

describe('computePutCallOiRatio', () => {
  it('is total put OI ÷ total call OI', () => {
    expect(computePutCallOiRatio([strike(100, 200, 300), strike(110, 100, 100)])).toBeCloseTo(400 / 300, 12);
  });

  it('returns null rather than coercing missing OI to zero', () => {
    expect(computePutCallOiRatio([strike(100, 100, null), strike(110, null, 50)])).toBeNull();
  });

  it('is null when call OI is zero or absent — the ratio is undefined, not 0', () => {
    expect(computePutCallOiRatio([])).toBeNull();
    expect(computePutCallOiRatio([strike(100, 0, 500)])).toBeNull();
    expect(computePutCallOiRatio([strike(100, null, 500)])).toBeNull();
  });
});

describe('options envelope provenance contract', () => {
  it('a synthetic envelope carries a note; a live one does not', () => {
    const synthetic: DvolSnapshot = {
      symbol: 'BTC',
      value: 55,
      history: [],
      asOf: 1_700_000_000_000,
      provenance: 'synthetic',
      source: 'mock',
      note: 'Synthetic DVOL — not a real volatility index.',
    };
    expect(provenanceNoteConsistent(synthetic.provenance, synthetic.note)).toBe(true);
    expect(provenanceNoteConsistent('live', null)).toBe(true);
    // An unavailable/synthetic envelope without a caveat violates the shared rule.
    expect(provenanceNoteConsistent('unavailable', null)).toBe(false);
    expect(provenanceNoteConsistent('synthetic', '')).toBe(false);
  });

  it('unavailable snapshots carry nulls, not fabricated zeros', () => {
    const term: TermStructure = {
      underlying: 'DOGE',
      referencePrice: null,
      perpPrice: null,
      points: [],
      asOf: null,
      provenance: 'unavailable',
      source: 'ccxt:deribit',
      note: 'Deribit lists no dated DOGE futures.',
    };
    expect(provenanceNoteConsistent(term.provenance, term.note)).toBe(true);
    expect(term.points).toEqual([]);
    const chain: OptionsChain = {
      underlying: 'DOGE',
      expiry: 0,
      underlyingPrice: null,
      entries: [],
      maxPainStrike: null,
      putCallOiRatio: null,
      asOf: null,
      provenance: 'unavailable',
      source: 'ccxt:deribit',
      note: 'No options listed for DOGE.',
    };
    expect(chain.maxPainStrike).toBeNull();
    expect(chain.putCallOiRatio).toBeNull();
  });
});
