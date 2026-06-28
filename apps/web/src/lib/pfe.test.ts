import { describe, it, expect } from 'vitest';
import {
  pfeRawSeries,
  pfeSeries,
  computePfe,
  pfeZone,
  pfeBoard,
  sortPfe,
  type PfeRow,
} from './pfe';

// Machine-precision fixture for the RAW (un-normalized) formula, N=10, M=5.
// Confirmed by a multi-agent derive→fixture→verify workflow across three
// independent computations (high confidence): raw[19] = 74.72219991869574,
// smoothed[19] = 72.37586845723052.
const FIXTURE = [100, 101, 103, 102, 104, 106, 105, 107, 109, 108, 110, 112, 111, 113, 115, 114, 116, 118, 117, 119];
const RAW_NONE = [
  74.1463916284478, 74.72219991869574, 67.14241327987628, 74.72219991869574, 74.72219991869574,
  67.14241327987628, 74.72219991869574, 74.72219991869574, 67.14241327987628, 74.72219991869574,
];

// Same percentage shape compounded off two very different price levels.
const PCT = [0, 0.01, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02, 0.02, -0.01, 0.02];
const fromPct = (base: number): number[] => {
  const c = [base];
  for (let i = 1; i < PCT.length; i++) c.push(c[i - 1] * (1 + PCT[i]));
  return c;
};

describe('pfeRawSeries / pfeSeries', () => {
  it('matches the workflow-verified raw fixture (un-normalized)', () => {
    const raw = pfeRawSeries(FIXTURE, 10, 'none');
    expect(raw).toHaveLength(10); // one value per bar from index 10..19
    raw.forEach((v, i) => expect(v).toBeCloseTo(RAW_NONE[i], 10));
    expect(raw[raw.length - 1]).toBeCloseTo(74.72219991869574, 10);

    const smooth = pfeSeries(FIXTURE, 10, 5, 'none');
    expect(smooth[smooth.length - 1]).toBeCloseTo(72.37586845723052, 10);
  });

  it('is bounded ±100 and hits the rails on a perfectly straight move', () => {
    const up = Array.from({ length: 16 }, (_, i) => 10 + i);
    const down = Array.from({ length: 16 }, (_, i) => 100 - i);
    expect(pfeRawSeries(up, 10, 'none').at(-1)!).toBeCloseTo(100, 9);
    expect(pfeRawSeries(down, 10, 'none').at(-1)!).toBeCloseTo(-100, 9);
  });

  it('returns an empty tail when there are not more than lookback closes', () => {
    expect(pfeRawSeries(FIXTURE.slice(0, 10), 10, 'none')).toEqual([]);
    expect(pfeSeries(FIXTURE.slice(0, 10), 10, 5, 'none')).toEqual([]);
  });
});

describe('computePfe scale-invariance', () => {
  it("'rebase' makes the same percentage shape comparable across price magnitude", () => {
    const big = computePfe(fromPct(50_000), 10, 5, 'rebase', 100)!; // BTC-like
    const small = computePfe(fromPct(0.0005), 10, 5, 'rebase', 100)!; // sub-penny alt
    expect(Math.abs(big.pfe - small.pfe)).toBeLessThan(1e-9);
  });

  it("'none' (raw) diverges wildly across price magnitude — the trap the board avoids", () => {
    const big = computePfe(fromPct(50_000), 10, 5, 'none')!;
    const small = computePfe(fromPct(0.0005), 10, 5, 'none')!;
    expect(Math.abs(big.pfe - small.pfe)).toBeGreaterThan(30);
    // the sub-dollar series saturates toward the rail
    expect(Math.abs(small.pfe)).toBeGreaterThan(99);
  });

  it('reports a bounded signed reading with the default rebase normalization', () => {
    const r = computePfe(FIXTURE, 10, 5)!; // default rebase, R=100
    expect(r.pfe).toBeCloseTo(73.5161666629655, 9);
    expect(r.strength).toBe(Math.abs(r.pfe));
    expect(r.zone).toBe('up');
    expect(r.n).toBe(20);
  });

  it('returns null on too little history or bad params', () => {
    expect(computePfe(FIXTURE.slice(0, 10), 10, 5)).toBeNull();
    expect(computePfe([], 10, 5)).toBeNull();
    expect(computePfe(FIXTURE, 0, 5)).toBeNull();
    expect(computePfe(FIXTURE, 10, 0)).toBeNull();
  });
});

describe('pfeZone', () => {
  it('classifies against the ±50 trend guides', () => {
    expect(pfeZone(80)).toBe('up');
    expect(pfeZone(50)).toBe('up');
    expect(pfeZone(20)).toBe('choppy');
    expect(pfeZone(-10)).toBe('choppy');
    expect(pfeZone(-50)).toBe('down');
    expect(pfeZone(-92)).toBe('down');
  });
});

describe('pfeBoard / sortPfe', () => {
  const up = Array.from({ length: 30 }, (_, i) => 10 + i); // strong +PFE
  const down = Array.from({ length: 30 }, (_, i) => 100 - i); // strong −PFE
  const chop = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 140)); // huge path, ~0 net → low |PFE|
  const series = [
    { symbol: 'UP', closes: up },
    { symbol: 'DN', closes: down },
    { symbol: 'CH', closes: chop },
  ];

  it('sorts by signed PFE descending by default (efficient up-trends on top)', () => {
    const rows = pfeBoard(series, 'pfe', 10, 5);
    expect(rows[0].symbol).toBe('UP');
    expect(rows[rows.length - 1].symbol).toBe('DN');
  });

  it('sorts by strength (|PFE|, trendiness regardless of direction)', () => {
    const rows = pfeBoard(series, 'strength', 10, 5);
    expect(rows[rows.length - 1].symbol).toBe('CH'); // choppiest last
  });

  it('sorts by symbol', () => {
    const rows = pfeBoard(series, 'symbol', 10, 5);
    expect(rows.map((r) => r.symbol)).toEqual(['CH', 'DN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = pfeBoard(
      [
        { symbol: 'OK', closes: up },
        { symbol: 'THIN', closes: up.slice(0, 8) },
      ],
      'pfe',
      10,
      5,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortPfe orders a plain row set by signed PFE', () => {
    const rows = [
      { symbol: 'A', pfe: -40, strength: 40 },
      { symbol: 'B', pfe: 75, strength: 75 },
      { symbol: 'C', pfe: 12, strength: 12 },
    ] as PfeRow[];
    expect(sortPfe(rows, 'pfe').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
