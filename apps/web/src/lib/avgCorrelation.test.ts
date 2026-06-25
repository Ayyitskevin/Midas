import { describe, it, expect } from 'vitest';
import { avgCorrelation } from './avgCorrelation';

const times = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('avgCorrelation', () => {
  it('averages a single perfectly-correlated pair to 1', () => {
    const a = [0.01, 0.02, 0.01, 0.02];
    const b = a.map((x) => 2 * x); // perfectly correlated
    const r = avgCorrelation([a, b], times(4), 4);
    expect(r.points).toHaveLength(1);
    expect(r.points[0].time).toBe(3);
    expect(r.points[0].pairs).toBe(1);
    expect(r.current).toBeCloseTo(1, 10);
  });

  it('averages all distinct pairs across three symbols', () => {
    const a = [0.01, -0.02, 0.03, -0.01];
    const b = a.map((x) => 2 * x); // corr +1 with a
    const c = a.map((x) => -x); // corr −1 with a and b
    const r = avgCorrelation([a, b, c], times(4), 4);
    // pairs: (a,b)=+1, (a,c)=−1, (b,c)=−1 → mean −1/3
    expect(r.points[0].pairs).toBe(3);
    expect(r.current).toBeCloseTo(-1 / 3, 10);
  });

  it('rolls the window and tracks current / min / max', () => {
    const a = [0.01, 0.02, 0.01, 0.02, 0.01, 0.02, 0.01, 0.02];
    // First window correlates (+2×), last window anti-correlates (−2×).
    const b = [0.02, 0.04, 0.02, 0.04, -0.02, -0.04, -0.02, -0.04];
    const r = avgCorrelation([a, b], times(8), 4);
    expect(r.points).toHaveLength(5); // j = 3..7
    expect(r.points[0].time).toBe(3);
    expect(r.max).toBeCloseTo(1, 10); // earliest window
    expect(r.current).toBeCloseTo(-1, 10); // latest window
    expect(r.min).toBeCloseTo(-1, 10);
  });

  it('returns an empty result without enough symbols or data', () => {
    expect(avgCorrelation([], times(4), 4).points).toHaveLength(0);
    expect(avgCorrelation([[0.01, 0.02, 0.03, 0.04]], times(4), 4).current).toBeNull(); // 1 symbol
    expect(avgCorrelation([[0.01, 0.02, 0.03], [0.02, 0.04, 0.06]], times(3), 4).current).toBeNull(); // len < window
    expect(avgCorrelation([[0.01, 0.02], [0.02, 0.04]], times(2), 1).points).toHaveLength(0); // window < 2
  });
});
