import { describe, it, expect } from 'vitest';
import { almaSeries, computeAlma, almaBoard, sortAlma, type AlmaRow } from './alma';

// Machine-precision fixture, N=9, offset=0.85, sigma=6 (TradingView ta.alma
// default — m UNFLOORED). Confirmed by a multi-agent derive→fixture→verify
// workflow across three independent computations (high confidence):
// ALMA[11] = 19.537194543716783, ALMA[10] = 18.364132147807595,
// floored variant = 18.878371403752393.
const FIXTURE = [10, 11, 13, 12, 14, 16, 15, 17, 19, 18, 20, 22];

describe('almaSeries', () => {
  it('matches the workflow-verified fixture (unfloored m, the default)', () => {
    const s = almaSeries(FIXTURE, 9, 0.85, 6);
    expect(s[11]).toBeCloseTo(19.537194543716783, 10);
    expect(s[10]).toBeCloseTo(18.364132147807595, 10);
    // indices < window-1 are NaN (insufficient history); the first valid is index 8.
    expect(Number.isNaN(s[7])).toBe(true);
    expect(Number.isFinite(s[8])).toBe(true);
  });

  it('floors the peak only when asked (the community-port variant)', () => {
    expect(almaSeries(FIXTURE, 9, 0.85, 6, true).at(-1)!).toBeCloseTo(18.878371403752393, 10);
  });

  it('reduces to the constant on a flat series (weights sum to 1)', () => {
    const flat = new Array(12).fill(50);
    expect(almaSeries(flat, 9, 0.85, 6).at(-1)!).toBeCloseTo(50, 9);
  });

  it('returns an all-NaN array shorter than the window', () => {
    const s = almaSeries(FIXTURE.slice(0, 8), 9, 0.85, 6);
    expect(s.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('computeAlma', () => {
  it('reports scale-invariant slope% and dist% off the verified fixture', () => {
    const r = computeAlma(FIXTURE, 9, 0.85, 6)!;
    expect(r.alma).toBeCloseTo(19.537194543716783, 10);
    expect(r.slopePct).toBeCloseTo(6.387791083551063, 10);
    expect(r.distPct).toBeCloseTo(12.605727248978345, 10);
    expect(r.dir).toBe('up');
    expect(r.n).toBe(12);
  });

  it('honours the floor option', () => {
    expect(computeAlma(FIXTURE, 9, 0.85, 6, true)!.alma).toBeCloseTo(18.878371403752393, 10);
  });

  it('slope% / dist% are comparable across price magnitude', () => {
    const PCT = [0, 0.01, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02];
    const fromPct = (b: number): number[] => {
      const c = [b];
      for (let i = 1; i < PCT.length; i++) c.push(c[i - 1] * (1 + PCT[i]));
      return c;
    };
    const big = computeAlma(fromPct(60_000), 9, 0.85, 6)!;
    const small = computeAlma(fromPct(0.5), 9, 0.85, 6)!;
    expect(Math.abs(big.slopePct - small.slopePct)).toBeLessThan(1e-9);
    expect(Math.abs(big.distPct - small.distPct)).toBeLessThan(1e-9);
  });

  it('returns null with fewer than window+1 closes or bad params', () => {
    expect(computeAlma(FIXTURE.slice(0, 9), 9, 0.85, 6)).toBeNull(); // need ≥ 10
    expect(computeAlma([], 9, 0.85, 6)).toBeNull();
    expect(computeAlma(FIXTURE, 0, 0.85, 6)).toBeNull();
    expect(computeAlma(FIXTURE, 9, 0.85, 0)).toBeNull();
  });
});

describe('almaBoard / sortAlma', () => {
  const up = Array.from({ length: 16 }, (_, i) => 100 + i); // rising line
  const down = Array.from({ length: 16 }, (_, i) => 100 - i); // falling line
  const flat = new Array(16).fill(100); // flat line
  const series = [
    { symbol: 'UP', closes: up },
    { symbol: 'DN', closes: down },
    { symbol: 'FL', closes: flat },
  ];

  it('sorts by slope% descending by default (strongest up-trend first)', () => {
    const rows = almaBoard(series, 'slope', 9, 0.85, 6);
    expect(rows[0].symbol).toBe('UP');
    expect(rows[rows.length - 1].symbol).toBe('DN');
  });

  it('sorts by symbol', () => {
    const rows = almaBoard(series, 'symbol', 9, 0.85, 6);
    expect(rows.map((r) => r.symbol)).toEqual(['DN', 'FL', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = almaBoard(
      [
        { symbol: 'OK', closes: up },
        { symbol: 'THIN', closes: up.slice(0, 9) },
      ],
      'slope',
      9,
      0.85,
      6,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortAlma orders a plain row set by dist% descending', () => {
    const rows = [
      { symbol: 'A', distPct: -2 },
      { symbol: 'B', distPct: 5 },
      { symbol: 'C', distPct: 1 },
    ] as AlmaRow[];
    expect(sortAlma(rows, 'dist').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
