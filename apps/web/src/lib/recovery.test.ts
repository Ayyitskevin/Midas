import { describe, it, expect } from 'vitest';
import { recoveryStats, computeRecovery, recoveryBoard, sortRecovery } from './recovery';
import { drawdownStats } from './drawdown';

describe('recoveryStats', () => {
  it('counts recovered episodes and averages their underwater length', () => {
    // dd runs: [-.1,-.05] recovers (len 2), then [-.2] recovers (len 1).
    const s = recoveryStats([100, 90, 95, 100, 80, 100]);
    expect(s.current).toBe(0); // ends at a high
    expect(s.longest).toBe(2);
    expect(s.recovered).toBe(2);
    expect(s.avgRecovery).toBeCloseTo(1.5, 12); // (2 + 1) / 2
    expect(s.underwaterNow).toBe(false);
  });

  it('reports an ongoing (unrecovered) drawdown via current / underwaterNow', () => {
    const s = recoveryStats([100, 120, 90, 95]); // drops below the 120 peak and stays under
    expect(s.current).toBe(2);
    expect(s.longest).toBe(2);
    expect(s.recovered).toBe(0);
    expect(s.avgRecovery).toBeNull(); // nothing has recovered yet
    expect(s.underwaterNow).toBe(true);
  });

  it('is all-zero / null for a name that never drew down', () => {
    const s = recoveryStats([100, 110, 120]);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(0);
    expect(s.recovered).toBe(0);
    expect(s.avgRecovery).toBeNull();
  });

  it('lines up with drawdownStats underwater / longest-underwater', () => {
    const closes = [100, 90, 95, 100, 80, 100];
    const s = recoveryStats(closes);
    const d = drawdownStats(closes);
    expect(s.current).toBe(d.underwater);
    expect(s.longest).toBe(d.longestUW);
  });
});

describe('computeRecovery', () => {
  it('adds the worst drawdown and guards short series', () => {
    const r = computeRecovery([100, 90, 95, 100, 80, 100])!;
    expect(r.maxDD).toBeCloseTo(0.2, 12);
    expect(r.n).toBe(6);
    expect(computeRecovery([100, 90])).toBeNull();
  });
});

describe('recoveryBoard / sortRecovery', () => {
  const series = [
    { symbol: 'A', closes: [100, 90, 95, 100, 80, 100] }, // longest 2, current 0
    { symbol: 'B', closes: [100, 120, 90, 95] }, // longest 2, current 2 (ongoing)
    { symbol: 'C', closes: [100, 80, 70, 60, 100] }, // longest 3, current 0
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('filters short series and ranks by longest underwater (default)', () => {
    const board = recoveryBoard(series);
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    expect(board[0].symbol).toBe('C');
    expect(board[0].longest).toBe(3);
    expect(board.map((r) => r.symbol).sort()).toEqual(['A', 'B', 'C']);
  });

  it('sorts by current underwater and by symbol', () => {
    const board = recoveryBoard(series);
    expect(sortRecovery(board, 'current')[0].symbol).toBe('B'); // only B is underwater now
    expect(sortRecovery(board, 'symbol').map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });
});
