import { describe, it, expect } from 'vitest';
import { painIndex, computePain, painBoard, sortPain } from './pain';
import { ulcerIndex } from './ulcer';

describe('painIndex', () => {
  it('is zero for a flat or monotonically rising series', () => {
    expect(painIndex([100, 100, 100])).toBe(0);
    expect(painIndex([100, 110, 121, 130])).toBe(0);
    expect(painIndex([])).toBe(0);
  });

  it('is the mean of the absolute drawdowns', () => {
    // [100, 90, 100] → dd = [0, -0.1, 0] → mean |dd| = 0.1/3.
    expect(painIndex([100, 90, 100])).toBeCloseTo(0.1 / 3, 12);
    // [100, 80, 100] → 0.2/3.
    expect(painIndex([100, 80, 100])).toBeCloseTo(0.2 / 3, 12);
  });

  it('uses the running peak, so a lower-low deepens the average', () => {
    // [100, 90, 80] → dd = [0, -0.1, -0.2] → mean (0.1+0.2)/3.
    expect(painIndex([100, 90, 80])).toBeCloseTo(0.3 / 3, 12);
  });

  it('never exceeds the max drawdown and is ≤ the Ulcer Index (mean ≤ RMS)', () => {
    const closes = [100, 95, 80, 90, 70, 110, 100];
    const pain = painIndex(closes);
    const maxDD = Math.abs(
      Math.min(
        ...closes.map((_, i) => {
          const peak = Math.max(...closes.slice(0, i + 1));
          return closes[i] / peak - 1;
        }),
      ),
    );
    expect(pain).toBeLessThanOrEqual(maxDD + 1e-12);
    expect(pain).toBeLessThanOrEqual(ulcerIndex(closes) + 1e-12);
  });
});

describe('computePain', () => {
  it('returns null with fewer than three closes', () => {
    expect(computePain([100, 90], 365)).toBeNull();
    expect(computePain([100], 365)).toBeNull();
  });

  it('has zero pain and a null Pain Ratio for a monotonic riser', () => {
    const r = computePain([100, 110, 121], 365)!;
    expect(r.painIndex).toBe(0);
    expect(r.maxDD).toBe(0);
    expect(r.painRatio).toBeNull();
    expect(r.annReturn).toBeCloseTo(0.1 * 365, 9);
  });

  it('computes Pain ratio = annReturn / painIndex with a drawdown present', () => {
    const closes = [100, 110, 99, 121, 108];
    const r = computePain(closes, 365)!;
    expect(r.painIndex).toBeGreaterThan(0);
    expect(r.painRatio).toBeCloseTo(r.annReturn / r.painIndex, 12);
    expect(r.painIndex).toBeLessThanOrEqual(r.maxDD + 1e-12);
  });
});

describe('painBoard / sortPain', () => {
  const calm = [100, 101, 100, 102, 101, 103, 102, 104]; // shallow dips
  const ouch = [100, 80, 95, 70, 90, 60, 85, 100]; // deep, long underwater
  const rise = [100, 102, 104, 106, 108, 110, 112, 114]; // monotonic → null ratio

  it('drops too-short series and defaults to Pain ratio descending', () => {
    const board = painBoard(
      [
        { symbol: 'CALM', closes: calm },
        { symbol: 'OUCH', closes: ouch },
        { symbol: 'SHORT', closes: [100, 90] },
      ],
      365,
    );
    expect(board.map((r) => r.symbol).sort()).toEqual(['CALM', 'OUCH']);
    expect(board[0].painRatio! >= (board[1].painRatio ?? -Infinity)).toBe(true);
  });

  it('sorts by pain index with the most pain first', () => {
    const board = painBoard(
      [
        { symbol: 'CALM', closes: calm },
        { symbol: 'OUCH', closes: ouch },
      ],
      365,
      'painIndex',
    );
    expect(board[0].symbol).toBe('OUCH');
    expect(board[0].painIndex).toBeGreaterThan(board[1].painIndex);
  });

  it('sinks a null Pain Ratio (no drawdown) to the bottom', () => {
    const board = painBoard(
      [
        { symbol: 'RISE', closes: rise },
        { symbol: 'OUCH', closes: ouch },
      ],
      365,
      'painRatio',
    );
    expect(board[board.length - 1].symbol).toBe('RISE');
  });

  it('sorts by symbol alphabetically', () => {
    const board = sortPain(
      [
        { symbol: 'ZZZ', painIndex: 0.1, maxDD: 0.2, annReturn: 0.5, painRatio: 5, n: 10 },
        { symbol: 'AAA', painIndex: 0.2, maxDD: 0.3, annReturn: 0.4, painRatio: 2, n: 10 },
      ],
      'symbol',
    );
    expect(board.map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
