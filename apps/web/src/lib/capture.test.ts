import { describe, it, expect } from 'vitest';
import { computeCapture, captureBoard } from './capture';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

const BENCH = [0.02, -0.01, 0.03, -0.02]; // 2 up days, 2 down days

describe('computeCapture', () => {
  it('captures more upside than downside (ratio > 1)', () => {
    const c = computeCapture([0.01, -0.02, 0.06, -0.01], BENCH);
    expect(c.upDays).toBe(2);
    expect(c.downDays).toBe(2);
    expect(c.up).toBeCloseTo(1.4, 10); // 0.07 / 0.05
    expect(c.down).toBeCloseTo(1.0, 10); // −0.03 / −0.03
    expect(c.ratio).toBeCloseTo(1.4, 10);
  });

  it('reports symmetric half-capture', () => {
    const c = computeCapture([0.01, -0.005, 0.015, -0.01], BENCH);
    expect(c.up).toBeCloseTo(0.5, 10);
    expect(c.down).toBeCloseTo(0.5, 10);
    expect(c.ratio).toBeCloseTo(1.0, 10);
  });

  it('leaves downside / ratio null when the benchmark never falls', () => {
    const c = computeCapture([0.02, 0.04, 0.06], [0.01, 0.02, 0.03]);
    expect(c.up).toBeCloseTo(2.0, 10); // 0.12 / 0.06
    expect(c.down).toBeNull();
    expect(c.ratio).toBeNull();
    expect(c.downDays).toBe(0);
  });
});

describe('captureBoard', () => {
  it('builds rows vs the benchmark and sorts by ratio, excluding the benchmark', () => {
    const board = captureBoard(
      [
        { symbol: 'BTC/USDT', closes: fromReturns(BENCH) },
        { symbol: 'ZZZ', closes: fromReturns([0.01, -0.02, 0.06, -0.01]) }, // ratio 1.4
        { symbol: 'AAA', closes: fromReturns([0.01, -0.005, 0.015, -0.01]) }, // ratio 1.0
      ],
      'BTC/USDT',
      'ratio',
    );
    expect(board.map((r) => r.symbol)).toEqual(['ZZZ', 'AAA']);
    expect(board[0].ratio).toBeCloseTo(1.4, 8);
    expect(board[1].ratio).toBeCloseTo(1.0, 8);
  });

  it('sorts alphabetically on request and returns [] without the benchmark', () => {
    const series = [
      { symbol: 'BTC/USDT', closes: fromReturns(BENCH) },
      { symbol: 'ZZZ', closes: fromReturns([0.01, -0.02, 0.06, -0.01]) },
      { symbol: 'AAA', closes: fromReturns([0.01, -0.005, 0.015, -0.01]) },
    ];
    expect(captureBoard(series, 'BTC/USDT', 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
    expect(captureBoard([series[1]], 'BTC/USDT')).toHaveLength(0);
  });
});
