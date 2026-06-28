import { describe, it, expect } from 'vitest';
import { computeVidya, vidyaBoard, sortVidya, type VidyaRow } from './vidya';

// Primary fixture — independently verified by a multi-agent workflow against the
// canonical CMO-based Chande VIDYA (pandas-ta / TradingView / MT5; reference impl
// + two adversarial recomputations, all machine-zero). The workflow corrected the
// seed to the SMA of the first N closes (925/9 ≈ 102.7778), not the first close.
const up = [100, 101, 102, 101, 103, 104, 103, 105, 106, 107, 106, 108, 109, 108, 110];
// Net decline → line slopes down, price below it, CMO negative.
const down = [110, 108, 109, 107, 106, 105, 103, 106, 105, 104, 107, 103, 102, 103, 100];

describe('computeVidya', () => {
  it('matches the workflow-verified VIDYA value (SMA seed)', () => {
    const r = computeVidya(up, 9)!;
    expect(r.vidya).toBeCloseTo(105.475071, 6);
    expect(r.prev).toBeCloseTo(104.972302, 6);
    expect(r.distPct).toBeCloseTo(4.290046, 5);
    expect(r.slopePct).toBeCloseTo(0.478955, 5);
    expect(r.cmo).toBeCloseTo(50, 9);
    expect(r.n).toBe(15);
  });

  it('slopes down with a negative CMO on a decline', () => {
    const r = computeVidya(down, 9)!;
    expect(r.distPct).toBeLessThan(0);
    expect(r.slopePct).toBeLessThan(0);
    expect(r.cmo).toBeLessThan(0);
  });

  it('keeps distPct, slopePct and CMO scale-invariant', () => {
    const r = computeVidya(up, 9)!;
    const scaled = computeVidya(
      up.map((c) => c * 1000),
      9,
    )!;
    expect(scaled.distPct).toBeCloseTo(r.distPct, 9);
    expect(scaled.slopePct).toBeCloseTo(r.slopePct, 9);
    expect(scaled.cmo).toBeCloseTo(r.cmo, 9);
  });

  it('returns null with fewer than period + 1 closes or a bad period', () => {
    expect(computeVidya(up.slice(0, 9), 9)).toBeNull();
    expect(computeVidya([], 9)).toBeNull();
    expect(computeVidya(up, 0)).toBeNull();
  });
});

describe('vidyaBoard', () => {
  const series = [
    { symbol: 'UP', closes: up }, // distPct ≈ +4.29, cmo +50
    { symbol: 'DOWN', closes: down }, // distPct ≈ −5.19, cmo −26
  ];

  it('defaults to sorting by distance above the line', () => {
    const rows = vidyaBoard(series, 'dist', 9);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
  });

  it('sorts by CMO descending', () => {
    const rows = vidyaBoard(series, 'cmo', 9);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
  });

  it('skips symbols with too little history', () => {
    const rows = vidyaBoard(
      [
        { symbol: 'OK', closes: up },
        { symbol: 'THIN', closes: up.slice(0, 9) },
      ],
      'dist',
      9,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortVidya', () => {
  it('orders by distPct descending', () => {
    const rows = [
      { symbol: 'A', distPct: 0.3, slopePct: 0, cmo: 0 },
      { symbol: 'B', distPct: 1.2, slopePct: 0, cmo: 0 },
      { symbol: 'C', distPct: -0.5, slopePct: 0, cmo: 0 },
    ] as VidyaRow[];
    expect(sortVidya(rows, 'dist').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
