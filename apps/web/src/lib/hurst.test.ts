import { describe, it, expect } from 'vitest';
import { hurstExponent, hurstBoard } from './hurst';

// Anti-persistent: returns flip sign every step → reversals dominate.
const alternating = Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
// Persistent: a smooth monotonic drift in the returns → strong within-chunk trend.
const ramp = Array.from({ length: 64 }, (_, i) => (32 - i) * 0.001);

/** Price path whose log returns reproduce `r`. */
const closesFromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * Math.exp(x));
  return out;
};

describe('hurstExponent', () => {
  it('flags an anti-persistent series as mean-reverting', () => {
    const h = hurstExponent(alternating)!;
    expect(h).not.toBeNull();
    expect(h.points).toHaveLength(3); // windows 8, 16, 32
    expect(h.hurst).toBeLessThan(0.1); // R/S flat across n → slope ≈ 0
    expect(h.regime).toBe('meanrev');
  });

  it('flags a persistent series as trending', () => {
    const h = hurstExponent(ramp)!;
    expect(h.hurst).toBeGreaterThan(0.55);
    expect(h.regime).toBe('trending');
    // The trending series must score higher than the mean-reverting one.
    expect(h.hurst).toBeGreaterThan(hurstExponent(alternating)!.hurst);
  });

  it('returns null without enough data for two windows', () => {
    expect(hurstExponent([])).toBeNull();
    expect(hurstExponent(Array.from({ length: 10 }, () => 0.01))).toBeNull(); // max window < 8
    expect(hurstExponent(alternating, 1)).toBeNull(); // minWindow < 2
  });
});

describe('hurstBoard', () => {
  it('builds, classifies and sorts rows by Hurst, dropping short series', () => {
    const board = hurstBoard(
      [
        { symbol: 'TREND', closes: closesFromReturns(ramp) },
        { symbol: 'REVERT', closes: closesFromReturns(alternating) },
        { symbol: 'SHORT', closes: [1, 2, 3, 4, 5] },
      ],
      'hurst',
    );
    expect(board.map((r) => r.symbol)).toEqual(['TREND', 'REVERT']);
    expect(board[0].regime).toBe('trending');
    expect(board[1].regime).toBe('meanrev');
  });

  it('sorts alphabetically on request', () => {
    const board = hurstBoard(
      [
        { symbol: 'SOL', closes: closesFromReturns(ramp) },
        { symbol: 'BTC', closes: closesFromReturns(alternating) },
      ],
      'symbol',
    );
    expect(board.map((r) => r.symbol)).toEqual(['BTC', 'SOL']);
  });
});
