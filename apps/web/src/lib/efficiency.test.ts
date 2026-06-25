import { describe, it, expect } from 'vitest';
import { computeEfficiency, efficiencyBoard } from './efficiency';

describe('computeEfficiency', () => {
  it('scores a clean one-way uptrend at 1', () => {
    const r = computeEfficiency([1, 2, 3, 4, 5], 4)!;
    expect(r.er).toBeCloseTo(1, 10);
    expect(r.direction).toBe(1);
    expect(r.changePct).toBeCloseTo(400, 10);
    expect(r.n).toBe(4);
  });

  it('scores a choppy, going-nowhere series at 0', () => {
    const r = computeEfficiency([1, 2, 1, 2, 1], 4)!;
    expect(r.er).toBeCloseTo(0, 10); // net 0 over path 4
    expect(r.direction).toBe(0);
    expect(r.changePct).toBeCloseTo(0, 10);
  });

  it('measures partial efficiency between the extremes', () => {
    const r = computeEfficiency([1, 2, 1, 2, 3], 4)!;
    expect(r.er).toBeCloseTo(0.5, 10); // net 2 over path 4
    expect(r.direction).toBe(1);
  });

  it('signs a clean downtrend negative', () => {
    const r = computeEfficiency([5, 4, 3, 2, 1], 4)!;
    expect(r.er).toBeCloseTo(1, 10);
    expect(r.direction).toBe(-1);
    expect(r.changePct).toBeCloseTo(-80, 10);
  });

  it('uses only the trailing window', () => {
    const r = computeEfficiency([100, 100, 1, 2, 3, 4, 5], 4)!;
    expect(r.er).toBeCloseTo(1, 10);
    expect(r.changePct).toBeCloseTo(400, 10);
  });

  it('returns null without enough history', () => {
    expect(computeEfficiency([1, 2, 3, 4], 4)).toBeNull(); // need window+1 closes
    expect(computeEfficiency([1, 2], 4)).toBeNull();
    expect(computeEfficiency([1, 2, 3, 4, 5], 0)).toBeNull();
  });
});

describe('efficiencyBoard', () => {
  it('builds and sorts by efficiency, dropping short series', () => {
    const board = efficiencyBoard(
      [
        { symbol: 'A', closes: [1, 2, 3, 4, 5] }, // er 1
        { symbol: 'B', closes: [1, 2, 1, 2, 3] }, // er 0.5
        { symbol: 'C', closes: [1, 2, 1, 2, 1] }, // er 0
        { symbol: 'D', closes: [1, 2] }, // too short
      ],
      4,
      'er',
    );
    expect(board.map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
    expect(board[0].er).toBeCloseTo(1, 10);
    expect(board[1].er).toBeCloseTo(0.5, 10);
  });
});
