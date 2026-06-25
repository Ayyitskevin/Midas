import { describe, it, expect } from 'vitest';
import { rollingSharpe } from './rollingSharpe';

const ANN = Math.sqrt(365);

/** Price path whose simple returns reproduce `r`, plus matching index times. */
function build(r: number[], start = 100): { closes: number[]; times: number[] } {
  const closes = [start];
  for (const x of r) closes.push(closes[closes.length - 1] * (1 + x));
  const times = closes.map((_, i) => i);
  return { closes, times };
}

describe('rollingSharpe', () => {
  it('computes one annualized Sharpe for a single full window', () => {
    const { closes, times } = build([0.01, 0.03, 0.01, 0.03]);
    const rs = rollingSharpe(closes, times, 4);
    // mean 0.02, σ 0.01 → Sharpe = 2·√365
    expect(rs.points).toHaveLength(1);
    expect(rs.points[0].time).toBe(4);
    expect(rs.points[0].sharpe).toBeCloseTo(2 * ANN, 4);
    expect(rs.current).toBeCloseTo(2 * ANN, 4);
    expect(rs.avg).toBeCloseTo(2 * ANN, 4);
    expect(rs.min).toBeCloseTo(rs.max!, 6);
  });

  it('rolls the window and tracks current / avg / min / max', () => {
    const { closes, times } = build([0.01, 0.03, 0.01, 0.03, 0.05]);
    const rs = rollingSharpe(closes, times, 4);
    expect(rs.points.map((p) => p.time)).toEqual([4, 5]);
    const last = (0.03 / (0.01 * Math.SQRT2)) * ANN; // window [0.03,0.01,0.03,0.05]
    expect(rs.current).toBeCloseTo(last, 4);
    expect(rs.max).toBeCloseTo(last, 4);
    expect(rs.min).toBeCloseTo(2 * ANN, 4);
    expect(rs.avg).toBeCloseTo((2 * ANN + last) / 2, 4);
  });

  it('contributes a Sharpe of 0 for a flat (zero-vol) window', () => {
    // A constant price → returns are exactly 0 → σ = 0.
    const closes = [100, 100, 100, 100, 100];
    const times = closes.map((_, i) => i);
    const rs = rollingSharpe(closes, times, 4);
    expect(rs.points).toHaveLength(1);
    expect(rs.points[0].sharpe).toBe(0);
    expect(rs.current).toBe(0);
  });

  it('returns an empty result when the window cannot be filled', () => {
    expect(rollingSharpe([], [], 4).points).toHaveLength(0);
    const short = build([0.01, 0.02]); // 3 closes, 2 returns
    expect(rollingSharpe(short.closes, short.times, 4).current).toBeNull();
    const ok = build([0.01, 0.02, 0.03, 0.04]);
    expect(rollingSharpe(ok.closes, ok.times, 1).points).toHaveLength(0); // window < 2
  });
});
