import { describe, it, expect } from 'vitest';
import { computeGapo, gapoBoard, sortGapo, type GapoBar, type GapoRow } from './gapo';

// Workflow-verified fixture (period N=4):
//   latest window (bars 1–4): HH=17, LL=9, range=8 → GAPO=ln(8)/ln(4)=1.5 exactly (8=4^1.5)
//   prior  window (bars 0–3): HH=15, LL=8, range=7 → GAPO=ln(7)/ln(4)=1.403677461…
//   slope = 1.5 − 1.403677461 = +0.096322539 (range expanding → dir 'up')
//   rangePct = 100·8/close(16) = 50
const expanding: GapoBar[] = [
  { high: 12, low: 8, close: 10 },
  { high: 14, low: 9, close: 13 },
  { high: 15, low: 10, close: 14 },
  { high: 13, low: 11, close: 12 },
  { high: 17, low: 9, close: 16 },
];

describe('computeGapo', () => {
  it('matches the hand-computed canonical GAPO and expansion slope', () => {
    const r = computeGapo(expanding, 4)!;
    expect(r).not.toBeNull();
    expect(r.gapo).toBeCloseTo(1.5, 9); // ln(8)/ln(4)
    expect(r.rangePct).toBeCloseTo(50, 9); // 100·8/16
    expect(r.slope).toBeCloseTo(1.5 - Math.log(7) / Math.log(4), 9);
    expect(r.dir).toBe('up');
    expect(r.n).toBe(5);
    expect(r.period).toBe(4);
  });

  it('is independent of the logarithm base (change-of-base cancels)', () => {
    const r = computeGapo(expanding, 4)!;
    // ln(8)/ln(4) === log10(8)/log10(4) === log2(8)/log2(4)
    expect(r.gapo).toBeCloseTo(Math.log10(8) / Math.log10(4), 12);
  });

  it('reports a contracting range as dir down with a negative slope', () => {
    const contracting: GapoBar[] = [
      { high: 20, low: 10, close: 15 },
      { high: 18, low: 11, close: 14 },
      { high: 17, low: 12, close: 15 },
      { high: 16, low: 13, close: 14 },
      { high: 16, low: 14, close: 15 },
    ];
    const r = computeGapo(contracting, 4)!;
    // latest window (bars 1–4): HH=18, LL=11, range=7 → GAPO=ln(7)/ln(4)
    expect(r.gapo).toBeCloseTo(Math.log(7) / Math.log(4), 9);
    expect(r.rangePct).toBeCloseTo((100 * 7) / 15, 9);
    expect(r.slope).toBeLessThan(0); // prior range (10) was wider
    expect(r.dir).toBe('down');
  });

  it('returns null on too little history, bad params, or a flat window', () => {
    expect(computeGapo([], 5)).toBeNull();
    // period + 1 = 5 bars needed for N=4.
    expect(computeGapo(expanding.slice(0, 4), 4)).toBeNull();
    expect(computeGapo(expanding, 4)).not.toBeNull();
    expect(computeGapo(expanding, 1)).toBeNull(); // period < 2
    // A perfectly flat window (range 0) → ln(0) undefined → null.
    const flat: GapoBar[] = Array.from({ length: 6 }, () => ({ high: 5, low: 5, close: 5 }));
    expect(computeGapo(flat, 4)).toBeNull();
  });

  it('works with the default period on a longer ramp', () => {
    const ramp: GapoBar[] = Array.from({ length: 40 }, (_, i) => ({
      high: 100 + i + 1,
      low: 100 + i - 1,
      close: 100 + i,
    }));
    const r = computeGapo(ramp)!; // default N=5
    expect(r).not.toBeNull();
    expect(r.period).toBe(5);
    expect(Number.isFinite(r.gapo)).toBe(true);
    expect(r.rangePct).toBeGreaterThan(0);
    expect(['up', 'down', 'flat']).toContain(r.dir);
  });
});

describe('gapoBoard / sortGapo', () => {
  const rows: GapoRow[] = [
    { symbol: 'B/USDT', gapo: 3.1, rangePct: 6, slope: 0.2, dir: 'up', period: 5, n: 40 },
    { symbol: 'A/USDT', gapo: 1.2, rangePct: 18, slope: -0.1, dir: 'down', period: 5, n: 40 },
    { symbol: 'C/USDT', gapo: 2.4, rangePct: 11, slope: 0.5, dir: 'up', period: 5, n: 40 },
  ];

  it('sorts by rangePct descending by default (widest relative range first)', () => {
    expect(sortGapo(rows, 'range').map((r) => r.rangePct)).toEqual([18, 11, 6]);
  });

  it('sorts by raw GAPO, slope, and symbol', () => {
    expect(sortGapo(rows, 'gapo').map((r) => r.gapo)).toEqual([3.1, 2.4, 1.2]);
    expect(sortGapo(rows, 'slope').map((r) => r.slope)).toEqual([0.5, 0.2, -0.1]);
    expect(sortGapo(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = gapoBoard(
      [
        { symbol: 'OK/USDT', bars: expanding },
        { symbol: 'THIN/USDT', bars: expanding.slice(0, 4) },
      ],
      'range',
      4,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
