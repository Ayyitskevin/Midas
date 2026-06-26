import { describe, it, expect } from 'vitest';
import { dualBetaBoard, sortDualBeta } from './dualBeta';

// Benchmark returns are orthogonal so the two betas are independent:
//   BTC b = [.1,-.1,.1,-.1]  (closes below)
//   ETH e = [.1,.1,-.1,-.1]  (Σ b·e = 0)
// ALT  = 2·b + 3·e  → βBTC 2, βETH 3, divergence 1
// ALT2 = 1·b + 1·e  → βBTC 1, βETH 1, divergence 0
const series = [
  { symbol: 'BTC/USDT', closes: [100, 110, 99, 108.9, 98.01] },
  { symbol: 'ETH/USDT', closes: [100, 110, 121, 108.9, 98.01] },
  { symbol: 'ALT', closes: [100, 150, 165, 148.5, 74.25] },
  { symbol: 'ALT2', closes: [100, 120, 120, 120, 96] },
  { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered
];

describe('dualBetaBoard', () => {
  it('computes beta to ETH and BTC and their divergence, omitting both benchmarks', () => {
    const board = dualBetaBoard(series, 'BTC/USDT', 'ETH/USDT');
    expect(board.map((r) => r.symbol)).toEqual(['ALT', 'ALT2']); // benchmarks + SHORT excluded; βETH desc 3>1

    const alt = board.find((r) => r.symbol === 'ALT')!;
    expect(alt.betaBtc).toBeCloseTo(2, 6);
    expect(alt.betaEth).toBeCloseTo(3, 6);
    expect(alt.divergence).toBeCloseTo(1, 6); // ETH-leaning
    expect(alt.corrEth).toBeCloseTo(0.83205, 4);
    expect(alt.n).toBe(4);

    const alt2 = board.find((r) => r.symbol === 'ALT2')!;
    expect(alt2.betaBtc).toBeCloseTo(1, 6);
    expect(alt2.betaEth).toBeCloseTo(1, 6);
    expect(alt2.divergence).toBeCloseTo(0, 6); // beta-neutral between the majors
  });

  it('returns [] when either benchmark series is missing', () => {
    const noEth = [
      { symbol: 'BTC/USDT', closes: [100, 110, 99, 108.9] },
      { symbol: 'X', closes: [100, 110, 120, 130] },
    ];
    expect(dualBetaBoard(noEth, 'BTC/USDT', 'ETH/USDT')).toEqual([]);
    const noBtc = [
      { symbol: 'ETH/USDT', closes: [100, 110, 121, 108.9] },
      { symbol: 'X', closes: [100, 110, 120, 130] },
    ];
    expect(dualBetaBoard(noBtc, 'BTC/USDT', 'ETH/USDT')).toEqual([]);
  });
});

describe('sortDualBeta', () => {
  const board = dualBetaBoard(series, 'BTC/USDT', 'ETH/USDT');

  it('sorts by symbol, divergence and betaBtc', () => {
    expect(sortDualBeta(board, 'symbol').map((r) => r.symbol)).toEqual(['ALT', 'ALT2']);
    expect(sortDualBeta(board, 'divergence').map((r) => r.symbol)).toEqual(['ALT', 'ALT2']); // 1 > 0
    expect(sortDualBeta(board, 'betaBtc').map((r) => r.symbol)).toEqual(['ALT', 'ALT2']); // 2 > 1
  });
});
