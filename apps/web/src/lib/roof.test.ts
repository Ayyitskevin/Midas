import { describe, it, expect } from 'vitest';
import {
  roofingFilter,
  agcNormalize,
  computeRoof,
  roofBoard,
  sortRoof,
  type RoofRow,
} from './roof';

// Machine-precision fixture for the raw Roofing Filter, hpPeriod=48, ssPeriod=10.
// Confirmed by a multi-agent derive→fixture→verify workflow across three
// independent computations (degrees-trig, hand-converted radians, EasyLanguage
// port), all on full Math.PI: Filt[18] = -3.7038602209839793, Filt[19] = -3.487887448907804.
const FIXTURE = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 114, 113, 115, 117, 116, 118, 120];

// Deterministic 20-bar sinusoid (in the 10–48 passband) riding a slow linear
// drift; the high-pass strips the drift, the SuperSmoother passes the cycle.
const sinDrift = (len: number): number[] =>
  Array.from({ length: len }, (_, i) => 100 + 10 * Math.sin((i * 2 * Math.PI) / 20) + 0.1 * i);

describe('roofingFilter', () => {
  it('matches the workflow-verified machine-precision fixture', () => {
    const { hp, filt } = roofingFilter(FIXTURE, 48, 10);
    expect(filt[18]).toBeCloseTo(-3.7038602209839793, 12);
    expect(filt[19]).toBeCloseTo(-3.487887448907804, 12);
    // Warm-up: first two HP and Filt values are 0-seeds.
    expect(hp[0]).toBe(0);
    expect(hp[1]).toBe(0);
    expect(filt[0]).toBe(0);
    expect(filt[1]).toBe(0);
  });

  it('strips a pure linear trend to zero (high-pass removes constant slope)', () => {
    // A linear ramp has zero second difference, so HP — and therefore Filt — stay 0.
    const ramp = Array.from({ length: 60 }, (_, i) => 50 + 0.5 * i);
    const { filt } = roofingFilter(ramp, 48, 10);
    expect(Math.max(...filt.map(Math.abs))).toBe(0);
  });

  it('returns arrays the length of the input and handles empties', () => {
    expect(roofingFilter([], 48, 10).filt).toEqual([]);
    expect(roofingFilter([100], 48, 10).filt).toEqual([0]);
    expect(roofingFilter(FIXTURE, 48, 10).filt).toHaveLength(20);
  });
});

describe('agcNormalize', () => {
  it('rescales by a fast-attack / slow-decay running peak', () => {
    expect(agcNormalize([0, 1, -2, 1, 0.5], 0.991)).toEqual([
      0,
      1,
      -1,
      0.5045408678102926,
      0.25456148729076317,
    ]);
  });

  it('stays bounded within ±1 and zeroes an all-zero input', () => {
    const norm = agcNormalize(roofingFilter(sinDrift(80), 48, 10).filt);
    expect(Math.max(...norm.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(agcNormalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('computeRoof', () => {
  it('matches the workflow-verified reading on the sinusoid-plus-drift series', () => {
    const r = computeRoof(sinDrift(80), 48, 10)!;
    expect(r.signal).toBeCloseTo(-0.28083080472952926, 12);
    expect(r.trigger).toBeCloseTo(-0.4781912381359881, 12);
    expect(r.filtPct).toBeCloseTo(-3.220644885022825, 12);
    expect(r.cross).toBe('none');
    expect(r.n).toBe(80);
    expect(Math.abs(r.signal)).toBeLessThanOrEqual(1);
  });

  it('reads ~0 on a pure linear ramp (trend filtered out)', () => {
    const ramp = Array.from({ length: 60 }, (_, i) => 50 + 0.5 * i);
    const r = computeRoof(ramp, 48, 10)!;
    expect(r.signal).toBe(0);
    expect(r.filtPct).toBe(0);
    expect(r.cross).toBe('none');
  });

  it('flags cyclic turns as bull (trough) and bear (peak)', () => {
    const series = sinDrift(120);
    expect(computeRoof(series.slice(0, 57), 48, 10)!.cross).toBe('bull');
    expect(computeRoof(series.slice(0, 67), 48, 10)!.cross).toBe('bear');
  });

  it('returns null with fewer than hpPeriod closes or bad params', () => {
    expect(computeRoof(sinDrift(47), 48, 10)).toBeNull();
    expect(computeRoof([], 48, 10)).toBeNull();
    expect(computeRoof(sinDrift(80), 0, 10)).toBeNull();
    expect(computeRoof(sinDrift(80), 48, 0)).toBeNull();
  });
});

describe('roofBoard', () => {
  // Phase-shifted sinusoids so the symbols carry distinct signal values.
  const a = Array.from({ length: 80 }, (_, i) => 100 + 8 * Math.sin((i * 2 * Math.PI) / 20));
  const b = Array.from({ length: 80 }, (_, i) => 100 + 8 * Math.sin((i * 2 * Math.PI) / 20 + 1.2));
  const series = [
    { symbol: 'AAA', closes: a },
    { symbol: 'BBB', closes: b },
  ];

  it('sorts by normalized signal descending by default', () => {
    const rows = roofBoard(series, 'roof', 48, 10);
    expect(rows).toHaveLength(2);
    expect(rows[0].signal).toBeGreaterThanOrEqual(rows[1].signal);
  });

  it('sorts by symbol', () => {
    const rows = roofBoard(series, 'symbol', 48, 10);
    expect(rows.map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
  });

  it('skips symbols with too little history', () => {
    const rows = roofBoard(
      [
        { symbol: 'OK', closes: a },
        { symbol: 'THIN', closes: a.slice(0, 30) },
      ],
      'roof',
      48,
      10,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortRoof', () => {
  it('orders by signal descending', () => {
    const rows = [
      { symbol: 'A', signal: -0.3 },
      { symbol: 'B', signal: 0.7 },
      { symbol: 'C', signal: 0.1 },
    ] as RoofRow[];
    expect(sortRoof(rows, 'roof').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
