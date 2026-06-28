import { describe, it, expect } from 'vitest';
import { computeVstop, vstopBoard, sortVstop, type VstopBar, type VstopRow } from './vstop';

// Workflow-verified base series (atrLength=2, factor=1), an up-leg that breaks down:
//   TR  = [2, 3, 3, 3, 6, 3]
//   Wilder ATR (from index 1) = [2.5, 2.75, 2.875, 4.4375, 3.71875]
//   stop (from bar 0) = [7, 8.5, 10.25, 11.125, 13.4375, 11.71875]
//   uptrend           = [T, T, T, T, false, false]   (flips toShort at bar 4)
// Latest bar (bar 5): dir 'short', stop 11.71875, distPct (8−11.71875)/8·100 = −46.484375.
const series: VstopBar[] = [
  { high: 10, low: 8, close: 9 },
  { high: 12, low: 9, close: 11 },
  { high: 14, low: 11, close: 13 },
  { high: 15, low: 12, close: 14 },
  { high: 13, low: 8, close: 9 },
  { high: 10, low: 7, close: 8 },
];

describe('computeVstop', () => {
  it('matches the hand-computed volatility stop after a breakdown', () => {
    const r = computeVstop(series, 2, 1)!;
    expect(r).not.toBeNull();
    expect(r.dir).toBe('short');
    expect(r.stop).toBeCloseTo(11.71875, 9);
    expect(r.distPct).toBeCloseTo(-46.484375, 9);
    expect(r.flip).toBe('none'); // the flip happened a bar earlier
    expect(r.n).toBe(6);
  });

  it('reports the flip on the bar it occurs', () => {
    // Truncate to bars 0–4: the breakdown bar is now the latest, so it flips short.
    const r = computeVstop(series.slice(0, 5), 2, 1)!;
    expect(r.dir).toBe('short');
    expect(r.stop).toBeCloseTo(13.4375, 9); // reset to close + atrM = 9 + 4.4375
    expect(r.flip).toBe('toShort');
    expect(r.distPct).toBeCloseTo(((9 - 13.4375) / 9) * 100, 9); // ≈ −49.31
  });

  it('rides a clean up-trend with the stop trailing below price', () => {
    const up: VstopBar[] = [
      { high: 10, low: 9, close: 10 },
      { high: 11, low: 10, close: 11 },
      { high: 12, low: 11, close: 12 },
      { high: 13, low: 12, close: 13 },
      { high: 14, low: 13, close: 14 },
    ];
    const r = computeVstop(up, 2, 1)!;
    expect(r.dir).toBe('long');
    expect(r.stop).toBeCloseTo(13, 9); // trails one ATR below the close
    expect(r.stop).toBeLessThan(14); // below price in an up-trend
    expect(r.distPct).toBeGreaterThan(0);
    expect(r.flip).toBe('none');
  });

  it('keeps the distPct sign aligned with the trend direction', () => {
    const long = computeVstop(
      [
        { high: 10, low: 9, close: 10 },
        { high: 11, low: 10, close: 11 },
        { high: 12, low: 11, close: 12 },
        { high: 13, low: 12, close: 13 },
      ],
      2,
      1,
    )!;
    expect(long.dir).toBe('long');
    expect(long.distPct).toBeGreaterThanOrEqual(0);

    const short = computeVstop(series, 2, 1)!;
    expect(short.dir).toBe('short');
    expect(short.distPct).toBeLessThanOrEqual(0);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeVstop([], 20, 2)).toBeNull();
    // atrLength + 1 = 3 bars needed for atrLength = 2.
    expect(computeVstop(series.slice(0, 2), 2, 1)).toBeNull();
    expect(computeVstop(series.slice(0, 3), 2, 1)).not.toBeNull();
    expect(computeVstop(series, 0, 1)).toBeNull();
    expect(computeVstop(series, 2, 0)).toBeNull();
    expect(computeVstop(series, 2, -1)).toBeNull();
  });

  it('works with default params (20·2) on a longer ramp', () => {
    const ramp: VstopBar[] = Array.from({ length: 60 }, (_, i) => ({
      high: 100 + i + 1,
      low: 100 + i - 1,
      close: 100 + i,
    }));
    const r = computeVstop(ramp)!;
    expect(r).not.toBeNull();
    expect(r.dir).toBe('long'); // a monotonic ramp stays long
    expect(r.stop).toBeLessThan(159); // stop trails below the final close
    expect(r.distPct).toBeGreaterThan(0);
  });
});

describe('vstopBoard / sortVstop', () => {
  const rows: VstopRow[] = [
    { symbol: 'B/USDT', dir: 'long', stop: 90, distPct: 5, flip: 'none', n: 60 },
    { symbol: 'A/USDT', dir: 'long', stop: 80, distPct: 12, flip: 'toLong', n: 60 },
    { symbol: 'C/USDT', dir: 'short', stop: 110, distPct: -8, flip: 'none', n: 60 },
  ];

  it('sorts by distPct descending by default (strongest long cushion first)', () => {
    expect(sortVstop(rows, 'distPct').map((r) => r.distPct)).toEqual([12, 5, -8]);
  });

  it('sorts by symbol', () => {
    expect(sortVstop(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = vstopBoard(
      [
        { symbol: 'OK/USDT', bars: series },
        { symbol: 'THIN/USDT', bars: series.slice(0, 2) },
      ],
      'distPct',
      2,
      1,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
