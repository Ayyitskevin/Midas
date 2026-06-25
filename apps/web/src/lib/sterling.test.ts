import { describe, it, expect } from 'vitest';
import {
  drawdownTroughs,
  computeSterling,
  sterlingBoard,
  sortSterling,
  STERLING_ADJ,
  type SterlingRow,
} from './sterling';

describe('drawdownTroughs', () => {
  it('records the trough of each distinct drawdown episode', () => {
    // [100,90,100,80,100] → dd [0,-.1,0,-.2,0] → two episodes.
    const t = drawdownTroughs([100, 90, 100, 80, 100]);
    expect(t).toHaveLength(2);
    expect(t[0]).toBeCloseTo(-0.1, 12);
    expect(t[1]).toBeCloseTo(-0.2, 12);
  });

  it('captures a single ongoing drawdown that never recovers', () => {
    const t = drawdownTroughs([100, 90, 80]);
    expect(t).toHaveLength(1);
    expect(t[0]).toBeCloseTo(-0.2, 12);
  });

  it('is empty for a monotonically rising series', () => {
    expect(drawdownTroughs([100, 110, 121])).toEqual([]);
  });
});

describe('computeSterling', () => {
  it('divides annualized return by the average drawdown plus 10%', () => {
    // Troughs −0.1, −0.2 → avgDD 0.15; denom 0.25.
    const r = computeSterling([100, 90, 100, 80, 100], 1)!;
    expect(r.avgDD).toBeCloseTo(0.15, 9);
    expect(r.maxDD).toBeCloseTo(0.2, 9);
    expect(r.episodes).toBe(2);
    expect(r.sterling).toBeCloseTo(r.annReturn / (0.15 + STERLING_ADJ), 12);
  });

  it('stays finite (no null) for a no-drawdown riser', () => {
    const r = computeSterling([100, 110, 121], 1)!;
    expect(r.avgDD).toBe(0);
    expect(r.episodes).toBe(0);
    expect(r.sterling).toBeCloseTo(r.annReturn / STERLING_ADJ, 12); // ÷ 0.10
  });

  it('returns null with fewer than three closes', () => {
    expect(computeSterling([100, 90], 1)).toBeNull();
  });
});

describe('sterlingBoard / sortSterling', () => {
  const steady = [100, 101, 100, 102, 101, 103, 102, 104]; // shallow dips, rising
  const rough = [100, 80, 95, 70, 90, 60, 85, 95]; // deep dips, choppy

  it('drops too-short series and defaults to Sterling descending', () => {
    const board = sterlingBoard(
      [
        { symbol: 'STEADY', closes: steady },
        { symbol: 'ROUGH', closes: rough },
        { symbol: 'SHORT', closes: [100, 90] },
      ],
      365,
    );
    expect(board.map((r) => r.symbol).sort()).toEqual(['ROUGH', 'STEADY']);
    expect(board[0].sterling).toBeGreaterThanOrEqual(board[1].sterling);
  });

  it('sorts by average drawdown and by symbol', () => {
    const rows: SterlingRow[] = [
      { symbol: 'ZZZ', sterling: 5, avgDD: 0.05, maxDD: 0.1, annReturn: 0.5, episodes: 2, n: 50 },
      { symbol: 'AAA', sterling: 2, avgDD: 0.2, maxDD: 0.3, annReturn: 0.4, episodes: 3, n: 50 },
    ];
    expect(sortSterling(rows, 'avgDD')[0].symbol).toBe('AAA'); // deeper avg DD first
    expect(sortSterling(rows, 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
