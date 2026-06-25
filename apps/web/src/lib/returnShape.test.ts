import { describe, it, expect } from 'vitest';
import { computeShape, shapeBoard } from './returnShape';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('computeShape', () => {
  it('reports ~zero skew for a symmetric return set', () => {
    const s = computeShape(fromReturns([-0.02, -0.01, 0, 0.01, 0.02]))!;
    expect(s).not.toBeNull();
    expect(s.skew).toBeCloseTo(0, 10);
    expect(s.n).toBe(5);
  });

  it('signs skew by which tail is longer', () => {
    expect(computeShape(fromReturns([-0.01, -0.01, -0.01, 0.03]))!.skew).toBeGreaterThan(0); // big up day
    expect(computeShape(fromReturns([0.01, 0.01, 0.01, -0.03]))!.skew).toBeLessThan(0); // big down day
  });

  it('flags fat tails with positive excess kurtosis', () => {
    const s = computeShape(fromReturns([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05]))!;
    expect(s.kurtosis).toBeGreaterThan(0);
  });

  it('returns null without enough returns', () => {
    expect(computeShape([100, 101])).toBeNull();
    expect(computeShape([100, 101, 102])).toBeNull(); // 2 returns
    expect(computeShape([])).toBeNull();
  });
});

describe('shapeBoard', () => {
  it('ranks by excess kurtosis and drops short series', () => {
    const fat = fromReturns([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05]); // leptokurtic
    const thin = fromReturns([-0.02, -0.01, 0, 0.01, 0.02]); // platykurtic
    const board = shapeBoard(
      [
        { symbol: 'THIN', closes: thin },
        { symbol: 'FAT', closes: fat },
        { symbol: 'SHORT', closes: [100, 101] },
      ],
      'kurtosis',
    );
    expect(board.map((r) => r.symbol)).toEqual(['FAT', 'THIN']);
    expect(board[0].kurtosis).toBeGreaterThan(board[1].kurtosis);
  });
});
