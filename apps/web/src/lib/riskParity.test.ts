import { describe, it, expect } from 'vitest';
import { riskParity } from './riskParity';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

const lowVol = fromReturns([0.01, -0.01, 0.01, -0.01]); // stdev 1%
const highVol = fromReturns([0.02, -0.02, 0.02, -0.02]); // stdev 2%

describe('riskParity', () => {
  it('weights inversely to volatility and equalizes risk', () => {
    const p = riskParity([
      { symbol: 'HI', closes: highVol },
      { symbol: 'LO', closes: lowVol },
    ]);
    expect(p.n).toBe(2);
    // Sorted by weight desc → the low-vol name carries the bigger weight.
    expect(p.rows[0].symbol).toBe('LO');
    expect(p.rows[0].weight).toBeCloseTo(2 / 3, 9); // (1/0.01)/(1/0.01+1/0.02)
    expect(p.rows[1].weight).toBeCloseTo(1 / 3, 9);
    expect(p.rows[0].vol).toBeCloseTo(0.01, 9);
    // Equal risk contribution by construction.
    expect(p.rows[0].riskContribPct).toBeCloseTo(50, 9);
    expect(p.rows[1].riskContribPct).toBeCloseTo(50, 9);
    expect(p.rows[0].equalWeight).toBeCloseTo(0.5, 9);
  });

  it('splits evenly when vols are equal', () => {
    const p = riskParity([
      { symbol: 'A', closes: lowVol },
      { symbol: 'B', closes: fromReturns([0.01, -0.01, 0.01, -0.01]) },
    ]);
    expect(p.rows[0].weight).toBeCloseTo(0.5, 9);
    expect(p.rows[1].weight).toBeCloseTo(0.5, 9);
  });

  it('drops flat and too-short series', () => {
    const p = riskParity([
      { symbol: 'OK', closes: lowVol },
      { symbol: 'FLAT', closes: [100, 100, 100, 100] }, // zero vol
      { symbol: 'SHORT', closes: [100] }, // no returns
    ]);
    expect(p.n).toBe(1);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].symbol).toBe('OK');
    expect(p.rows[0].weight).toBeCloseTo(1, 9);
    expect(p.rows[0].riskContribPct).toBeCloseTo(100, 9);
  });

  it('returns empty with no usable assets', () => {
    expect(riskParity([]).n).toBe(0);
    expect(riskParity([{ symbol: 'F', closes: [5, 5, 5] }]).rows).toHaveLength(0);
  });
});
