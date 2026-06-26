import { describe, it, expect } from 'vitest';
import { crossCorr, computeLeadLag, leadLagBoard, sortLeadLag } from './leadLag';

const BENCH = [0.1, -0.2, 0.3, -0.1, 0.2];

describe('crossCorr', () => {
  it('returns null when fewer than three points overlap', () => {
    expect(crossCorr([1, 2, 3], [4, 5, 6], 2)).toBeNull(); // only 1 overlapping pair
    expect(crossCorr([1, 2, 3, 4], [5, 6, 7, 8], 0)).not.toBeNull(); // 4 pairs
  });
});

describe('computeLeadLag', () => {
  it('detects a name that LAGS BTC by one period (peak at +1)', () => {
    // asset[t] = bench[t−1] for t≥1 → perfect correlation at lag +1.
    const lag = [0.05, 0.1, -0.2, 0.3, -0.1];
    const s = computeLeadLag(lag, BENCH, 1)!;
    expect(s.peakLag).toBe(1);
    expect(s.peakCorr).toBeCloseTo(1, 6);
  });

  it('detects a synchronous name (peak at 0)', () => {
    const s = computeLeadLag(BENCH, BENCH, 1)!;
    expect(s.peakLag).toBe(0);
    expect(s.peakCorr).toBeCloseTo(1, 6);
    expect(s.corr0).toBeCloseTo(1, 6);
  });

  it('detects a name that LEADS BTC by one period (peak at −1)', () => {
    // asset[t] = bench[t+1] → perfect correlation at lag −1.
    const lead = [-0.2, 0.3, -0.1, 0.2, 0.05];
    const s = computeLeadLag(lead, BENCH, 1)!;
    expect(s.peakLag).toBe(-1);
    expect(s.peakCorr).toBeCloseTo(1, 6);
  });

  it('returns null with too little overlap for even the lag-0 correlation', () => {
    expect(computeLeadLag([0.1, 0.2], [0.1, 0.2], 1)).toBeNull(); // 2 < MIN_PAIRS
  });
});

describe('leadLagBoard / sortLeadLag', () => {
  // closes reconstructed from the returns above.
  const series = [
    { symbol: 'BTC/USDT', closes: [100, 110, 88, 114.4, 102.96, 123.552] }, // BENCH
    { symbol: 'LAGGER', closes: [100, 105, 115.5, 92.4, 120.12, 108.108] }, // lags +1
    { symbol: 'SYNC', closes: [100, 110, 88, 114.4, 102.96, 123.552] }, // synchronous
    { symbol: 'LEADER', closes: [100, 80, 104, 93.6, 112.32, 117.936] }, // leads −1
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('omits BTC, filters short series, ranks most-leading first (peakLag asc)', () => {
    const board = leadLagBoard(series, 'BTC/USDT', 1);
    expect(board.map((r) => r.symbol)).toEqual(['LEADER', 'SYNC', 'LAGGER']); // −1, 0, +1
    expect(board.find((r) => r.symbol === 'LEADER')!.peakLag).toBe(-1);
    expect(board.find((r) => r.symbol === 'SYNC')!.peakLag).toBe(0);
    expect(board.find((r) => r.symbol === 'LAGGER')!.peakLag).toBe(1);
    expect(board.find((r) => r.symbol === 'LAGGER')!.peakCorr).toBeCloseTo(1, 6);
  });

  it('returns [] when the benchmark is missing, and sorts by symbol / peakCorr', () => {
    expect(leadLagBoard([{ symbol: 'X', closes: [100, 110, 120, 130] }], 'BTC/USDT', 1)).toEqual([]);
    const board = leadLagBoard(series, 'BTC/USDT', 1);
    expect(sortLeadLag(board, 'symbol').map((r) => r.symbol)).toEqual(['LAGGER', 'LEADER', 'SYNC']);
    // all three peak near corr 1, so peakCorr order is a stable near-tie — just check it runs
    expect(sortLeadLag(board, 'peakCorr')).toHaveLength(3);
  });
});
