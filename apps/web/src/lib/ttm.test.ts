import { describe, it, expect } from 'vitest';
import { computeTtm, ttmBoard, ttmSeries, sortTtm, type TtmBar, type TtmRow } from './ttm';

const bar = (high: number, low: number, close: number): TtmBar => ({ high, low, close });

// Flat closes (stdev 0) inside wide-range bars (atr > 0) → BB collapses inside
// KC → squeeze ON every window. mom = close − basis = 0.
const coiled: TtmBar[] = [bar(10, 0, 5), bar(10, 0, 5), bar(10, 0, 5)];

// Coil (ON) then a tight-range close jump to 30 (stdev explodes, BB blows
// outside KC) → squeeze fires OFF on the last bar, momentum turns up.
//   last window: sma 17.5, sd 12.5 (BB ±25), atr 12.5 (KC ±18.75) → OFF
//   mom = 30 − ((30+5)/2 + 17.5)/2 = 30 − 17.5 = 12.5
const fired: TtmBar[] = [bar(10, 0, 5), bar(10, 0, 5), bar(5, 5, 5), bar(30, 30, 30)];

describe('ttmSeries', () => {
  it('returns null with too little history', () => {
    expect(ttmSeries([bar(10, 0, 5), bar(10, 0, 5)], 2)).toBeNull(); // n < period + 1
    expect(ttmSeries([], 2)).toBeNull();
  });
});

describe('computeTtm', () => {
  it('detects an active squeeze with BB inside KC', () => {
    const r = computeTtm(coiled, 2)!;
    expect(r.squeeze).toBe('on');
    expect(r.fired).toBe(false);
    expect(r.bbWidth).toBeLessThan(r.kcWidth); // BB tighter than KC ⇒ squeezing
    expect(r.mom).toBeCloseTo(0, 6);
    expect(r.n).toBe(3);
  });

  it('fires when the squeeze releases (on → off)', () => {
    const r = computeTtm(fired, 2)!;
    expect(r.squeeze).toBe('off');
    expect(r.fired).toBe(true);
    expect(r.bbWidth).toBeGreaterThan(r.kcWidth); // BB expanded outside KC
    expect(r.mom).toBeCloseTo(12.5, 6);
    expect(r.momPct).toBeCloseTo((12.5 / 30) * 100, 6);
    expect(r.momDir).toBe('up');
    expect(r.momRising).toBe(true);
  });

  it('returns null with too little history', () => {
    expect(computeTtm([bar(10, 0, 5), bar(10, 0, 5)], 2)).toBeNull();
  });
});

describe('ttmBoard', () => {
  const series = [
    { symbol: 'COIL', bars: coiled },
    { symbol: 'FIRE', bars: fired },
  ];

  it('defaults to listing squeezing names first', () => {
    const rows = ttmBoard(series, 'squeeze', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['COIL', 'FIRE']);
    expect(rows[0].squeeze).toBe('on');
    expect(rows[1].squeeze).toBe('off');
  });

  it('sorts by symbol', () => {
    const rows = ttmBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['COIL', 'FIRE']);
  });

  it('skips symbols with too little history', () => {
    const rows = ttmBoard(
      [
        { symbol: 'OK', bars: coiled },
        { symbol: 'THIN', bars: [bar(10, 0, 5), bar(10, 0, 5)] },
      ],
      'squeeze',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortTtm', () => {
  it('orders by momentum % descending', () => {
    const rows = [
      { symbol: 'A', momPct: 3, squeeze: 'off' },
      { symbol: 'B', momPct: 9, squeeze: 'off' },
      { symbol: 'C', momPct: 1, squeeze: 'off' },
    ] as TtmRow[];
    expect(sortTtm(rows, 'mom').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
