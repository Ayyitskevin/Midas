import { describe, it, expect } from 'vitest';
import {
  computeSinewave,
  sinewaveBoard,
  sortSinewave,
  SINE_MIN_BARS,
  type SinewaveBar,
  type SinewaveRow,
} from './sinewave';

// Build a bar whose median (H+L)/2 equals `mid` (the indicator's price input).
const bar = (mid: number): SinewaveBar => ({ high: mid + 1, low: mid - 1, close: mid });
// A clean 20-bar cycle so the dominant-cycle estimate locks near 20.
const cycle = (len: number): SinewaveBar[] =>
  Array.from({ length: len }, (_, i) => bar(100 + 10 * Math.sin((2 * Math.PI * i) / 20)));

describe('computeSinewave', () => {
  it('matches the independently-verified fixture on a clean 20-bar cycle', () => {
    // Two independent reference impls got Sine=-0.30629784, LeadSine=0.45653493,
    // SmoothPeriod=20.0205. The exact 6th decimal is warm-up-convention sensitive
    // (the cycle estimate is still settling over only 80 bars — it converges on
    // ~1yr data); this implementation agrees to ~3e-5, so assert to ~1e-3.
    const r = computeSinewave(cycle(80))!;
    expect(r).not.toBeNull();
    expect(r.sine).toBeCloseTo(-0.3063, 3);
    expect(r.leadSine).toBeCloseTo(0.4565, 3);
    expect(r.smoothPeriod).toBeGreaterThan(19.5); // dominant cycle ≈ 20
    expect(r.smoothPeriod).toBeLessThan(20.5);
    expect(r.dir).toBe('bull'); // LeadSine above Sine
    expect(r.n).toBe(80);
  });

  it('keeps both lines bounded to [−1, +1]', () => {
    const r = computeSinewave(cycle(120))!;
    expect(r.sine).toBeGreaterThanOrEqual(-1);
    expect(r.sine).toBeLessThanOrEqual(1);
    expect(r.leadSine).toBeGreaterThanOrEqual(-1);
    expect(r.leadSine).toBeLessThanOrEqual(1);
  });

  it('stays finite and in range on a trend (no clean cycle)', () => {
    const ramp: SinewaveBar[] = Array.from({ length: 80 }, (_, i) => bar(100 + i));
    const r = computeSinewave(ramp)!;
    expect(Number.isFinite(r.sine)).toBe(true);
    expect(Number.isFinite(r.leadSine)).toBe(true);
    expect(r.sine).toBeGreaterThanOrEqual(-1);
    expect(r.sine).toBeLessThanOrEqual(1);
    expect(r.smoothPeriod).toBeGreaterThanOrEqual(6); // period clamp floor
  });

  it('returns null below the warm-up minimum', () => {
    expect(computeSinewave([])).toBeNull();
    expect(computeSinewave(cycle(SINE_MIN_BARS - 1))).toBeNull();
    expect(computeSinewave(cycle(SINE_MIN_BARS))).not.toBeNull();
  });
});

describe('sinewaveBoard / sortSinewave', () => {
  const rows: SinewaveRow[] = [
    { symbol: 'B/USDT', sine: 0.1, leadSine: 0.4, dir: 'bull', cross: 'none', smoothPeriod: 18, n: 200 },
    { symbol: 'A/USDT', sine: 0.5, leadSine: 0.9, dir: 'bull', cross: 'toBull', smoothPeriod: 22, n: 200 },
    { symbol: 'C/USDT', sine: 0.2, leadSine: -0.6, dir: 'bear', cross: 'toBear', smoothPeriod: 15, n: 200 },
  ];

  it('sorts by LeadSine descending by default', () => {
    expect(sortSinewave(rows, 'lead').map((r) => r.leadSine)).toEqual([0.9, 0.4, -0.6]);
  });

  it('sorts by symbol', () => {
    expect(sortSinewave(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = sinewaveBoard(
      [
        { symbol: 'OK/USDT', bars: cycle(80) },
        { symbol: 'THIN/USDT', bars: cycle(30) },
      ],
      'lead',
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
