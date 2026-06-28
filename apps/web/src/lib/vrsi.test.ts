import { describe, it, expect } from 'vitest';
import {
  computeVrsi,
  sveRainbow,
  wilderRsiSeries,
  vrsiZone,
  vrsiBoard,
  sortVrsi,
  type VrsiRow,
} from './vrsi';

// Workflow-verified reduced fixture (rsiPeriod=2, zlPeriod=2):
//   close   = [10,11,13,16,20,18,15,13,12,14]
//   rainbow = [10, 10.337772, 11.349575, 13.203996, 15.988793, 17.38353, …]
//   rsi(2)  = [100,100,100,100, 72.701946, 31.99346, 15.353955, 12.971818]
//   final inverse-Fisher vrsi = tanh(2·EMA1 − EMA2 of 0.1·(rsi−50)) = −0.9992512196934277
const closes = [10, 11, 13, 16, 20, 18, 15, 13, 12, 14];

describe('sveRainbow', () => {
  it('seeds rainbow[0] === close[0] (the x[-1]:=x[0] cascade seed)', () => {
    const r = sveRainbow(closes);
    expect(r).toHaveLength(closes.length);
    expect(r[0]).toBeCloseTo(10, 12);
  });

  it('matches the hand-computed rainbow at index 5', () => {
    expect(sveRainbow(closes)[5]).toBeCloseTo(17.38353, 4);
  });
});

describe('wilderRsiSeries', () => {
  it('reproduces the verified RSI subseries on the rainbow (period 2)', () => {
    const rsi = wilderRsiSeries(sveRainbow(closes), 2);
    expect(rsi).toHaveLength(closes.length - 2); // 8 defined points
    expect(rsi[0]).toBeCloseTo(100, 6); // monotonic rise → avgLoss 0 → 100
    expect(rsi[4]).toBeCloseTo(72.701946, 4);
    expect(rsi[7]).toBeCloseTo(12.971818, 4);
  });
});

describe('computeVrsi', () => {
  it('matches the workflow-verified end-to-end inverse-Fisher value', () => {
    const r = computeVrsi(closes, 2, 2)!;
    expect(r).not.toBeNull();
    expect(r.vrsi).toBeCloseTo(-0.9992512196934277, 12);
    expect(r.zone).toBe('oversold'); // ≤ −0.5
    expect(r.dir).toBe('down'); // still falling on the last bar
    expect(r.n).toBe(10);
  });

  it('stays within (−1, +1) and saturates near +1 on a steady up-trend', () => {
    const ramp = Array.from({ length: 40 }, (_, i) => 100 + i);
    const r = computeVrsi(ramp)!; // default 4/4
    expect(r.vrsi).toBeGreaterThan(0.5);
    expect(r.vrsi).toBeLessThan(1);
    expect(r.zone).toBe('overbought');
  });

  it('saturates near −1 on a steady down-trend', () => {
    const ramp = Array.from({ length: 40 }, (_, i) => 200 - i);
    const r = computeVrsi(ramp)!;
    expect(r.vrsi).toBeLessThan(-0.5);
    expect(r.vrsi).toBeGreaterThan(-1);
    expect(r.zone).toBe('oversold');
  });

  it('returns null on too little history or bad params', () => {
    expect(computeVrsi([], 4, 4)).toBeNull();
    // rsiPeriod + 2 = 4 closes needed for rsiPeriod 2.
    expect(computeVrsi([10, 11, 12], 2, 2)).toBeNull();
    expect(computeVrsi([10, 11, 12, 13], 2, 2)).not.toBeNull();
    expect(computeVrsi(closes, 0, 4)).toBeNull();
    expect(computeVrsi(closes, 4, 0)).toBeNull();
  });

  it('classifies zones against the ±0.5 band', () => {
    expect(vrsiZone(0.7)).toBe('overbought');
    expect(vrsiZone(-0.7)).toBe('oversold');
    expect(vrsiZone(0.2)).toBe('neutral');
    expect(vrsiZone(0.5)).toBe('overbought'); // inclusive
  });
});

describe('vrsiBoard / sortVrsi', () => {
  const rows: VrsiRow[] = [
    { symbol: 'B/USDT', vrsi: 0.3, prev: 0.1, dir: 'up', zone: 'neutral', n: 200 },
    { symbol: 'A/USDT', vrsi: 0.92, prev: 0.8, dir: 'up', zone: 'overbought', n: 200 },
    { symbol: 'C/USDT', vrsi: -0.88, prev: -0.7, dir: 'down', zone: 'oversold', n: 200 },
  ];

  it('sorts by VRSI descending by default (most overbought first)', () => {
    expect(sortVrsi(rows, 'vrsi').map((r) => r.vrsi)).toEqual([0.92, 0.3, -0.88]);
  });

  it('sorts by symbol', () => {
    expect(sortVrsi(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = vrsiBoard(
      [
        { symbol: 'OK/USDT', closes },
        { symbol: 'THIN/USDT', closes: [10, 11] },
      ],
      'vrsi',
      2,
      2,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
