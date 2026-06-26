import { describe, it, expect } from 'vitest';
import { computeIchimoku, ichimokuBoard, sortIchi, type IchiBar, type IchiRow } from './ichimoku';

const bar = (high: number, low: number, close: number): IchiBar => ({ high, low, close });

// Fixtures + expected values derived and adversarially verified (3/3 independent
// recomputations, one with exact rational arithmetic). See PR notes.

// UP: price above a bullish cloud with a fresh bullish TK cross. params 1/2/3.
const up: IchiBar[] = [bar(10, 8, 9), bar(11, 9, 10), bar(12, 10, 11), bar(13, 11, 12), bar(20, 8, 9), bar(30, 28, 30)];
// DOWN: price below a bearish cloud, no fresh cross. params 1/2/3.
const down: IchiBar[] = [bar(40, 38, 39), bar(39, 37, 38), bar(50, 36, 37), bar(20, 18, 19), bar(15, 13, 14), bar(12, 5, 6)];
// INSIDE: price inside a bullish cloud, flat TK tie. params 2/3/4 (n = 7 = minimal valid).
const inside: IchiBar[] = [
  bar(60, 20, 40),
  bar(60, 57, 58),
  bar(59, 57, 58),
  bar(60, 58, 59),
  bar(61, 59, 60),
  bar(62, 60, 61),
  bar(50, 50, 50),
];

describe('computeIchimoku', () => {
  it('price above a bullish cloud with a fresh bullish TK cross', () => {
    const r = computeIchimoku(up, 1, 2, 3)!;
    expect(r.tenkan).toBe(29);
    expect(r.kijun).toBe(19);
    expect(r.spanA).toBe(11.75);
    expect(r.spanB).toBe(11);
    expect(r.cloud).toBe('above');
    expect(r.tkCross).toBe('bull');
    expect(r.color).toBe('bull');
    expect(r.dist).toBeCloseTo(((30 - 11.75) / 30) * 100, 6);
    expect(r.n).toBe(6);
  });

  it('price below a bearish cloud, a continuation (no fresh cross)', () => {
    const r = computeIchimoku(down, 1, 2, 3)!;
    expect(r.tenkan).toBe(8.5);
    expect(r.kijun).toBe(10);
    expect(r.spanA).toBe(26.5);
    expect(r.spanB).toBe(34);
    expect(r.cloud).toBe('below');
    expect(r.tkCross).toBe('none');
    expect(r.color).toBe('bear');
    expect(r.dist).toBeCloseTo(((6 - 26.5) / 6) * 100, 6);
  });

  it('price inside a bullish cloud, with a Tenkan=Kijun tie → no cross', () => {
    const r = computeIchimoku(inside, 2, 3, 4)!;
    expect(r.tenkan).toBe(56);
    expect(r.kijun).toBe(56);
    expect(r.spanA).toBe(58.5);
    expect(r.spanB).toBe(40);
    expect(r.cloud).toBe('inside');
    expect(r.color).toBe('bull');
    expect(r.tkCross).toBe('none');
    expect(r.dist).toBe(0);
  });

  it('returns null below the minimum bar count (kijun + senkouB)', () => {
    // params 1/2/3 → needs 5 bars; 4 is one short.
    expect(computeIchimoku([bar(10, 8, 9), bar(11, 9, 10), bar(12, 10, 11), bar(13, 11, 12)], 1, 2, 3)).toBeNull();
    // one more bar clears it.
    expect(computeIchimoku([bar(10, 8, 9), bar(11, 9, 10), bar(12, 10, 11), bar(13, 11, 12), bar(14, 12, 13)], 1, 2, 3)).not.toBeNull();
    expect(computeIchimoku([], 1, 2, 3)).toBeNull();
  });
});

describe('ichimokuBoard', () => {
  const series = [
    { symbol: 'UP', bars: up },
    { symbol: 'DOWN', bars: down },
  ];

  it('defaults to most-bullish-cloud first', () => {
    const rows = ichimokuBoard(series, 'cloud', 1, 2, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].cloud).toBe('above');
    expect(rows[1].cloud).toBe('below');
  });

  it('sorts by symbol', () => {
    const rows = ichimokuBoard(series, 'symbol', 1, 2, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = ichimokuBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: [bar(10, 8, 9), bar(11, 9, 10)] },
      ],
      'cloud',
      1,
      2,
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortIchi', () => {
  it('orders by distance from the cloud descending', () => {
    const rows = [
      { symbol: 'A', dist: 3, cloud: 'above' },
      { symbol: 'B', dist: 9, cloud: 'above' },
      { symbol: 'C', dist: -4, cloud: 'below' },
    ] as IchiRow[];
    expect(sortIchi(rows, 'dist').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
