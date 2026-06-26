import { describe, it, expect } from 'vitest';
import { computeUo, uoBoard, uoZone, sortUo, type UoBar, type UoRow } from './ultimate';

const bar = (high: number, low: number, close: number): UoBar => ({ high, low, close });

// Uptrend (params 1/2/3). Hand-computed BP/TR for bars 1..3:
//   i=1: BP=11−min(9,9)=2, TR=max(12,9)−9=3
//   i=2: BP=12−min(10,11)=2, TR=max(13,11)−10=3
//   i=3: BP=14−min(11,12)=3, TR=max(15,12)−11=4
//   Avg1=3/4, Avg2=5/7, Avg3=7/10 → UO=100·(3 + 10/7 + 7/10)/7 = 35900/490 = 73.265306…
const uptrend: UoBar[] = [bar(10, 8, 9), bar(12, 9, 11), bar(13, 10, 12), bar(15, 11, 14)];

// Downtrend (params 1/2/3): each bar BP=1, TR=4 → every Avg=1/4 → UO=100·1.75/7 = 25.
const downtrend: UoBar[] = [bar(15, 11, 14), bar(13, 10, 11), bar(12, 8, 9), bar(10, 6, 7)];

describe('uoZone', () => {
  it('classifies on the 70 / 30 thresholds (inclusive)', () => {
    expect(uoZone(85)).toBe('overbought');
    expect(uoZone(70)).toBe('overbought');
    expect(uoZone(50)).toBe('neutral');
    expect(uoZone(30)).toBe('oversold');
    expect(uoZone(15)).toBe('oversold');
  });
});

describe('computeUo', () => {
  it('blends the three timeframes (uptrend → overbought)', () => {
    const uo = computeUo(uptrend, 1, 2, 3)!;
    expect(uo).toBeCloseTo(35900 / 490, 6); // 73.265306…
    expect(uoZone(uo)).toBe('overbought');
  });

  it('reads low on a downtrend (→ oversold)', () => {
    const uo = computeUo(downtrend, 1, 2, 3)!;
    expect(uo).toBeCloseTo(25, 6);
    expect(uoZone(uo)).toBe('oversold');
  });

  it('contributes 0 on a flat (zero true range) window', () => {
    const flat = [bar(100, 100, 100), bar(100, 100, 100), bar(100, 100, 100), bar(100, 100, 100)];
    expect(computeUo(flat, 1, 2, 3)).toBe(0);
  });

  it('returns null with too little history (< p3 + 1 bars)', () => {
    expect(computeUo([bar(10, 8, 9), bar(12, 9, 11), bar(13, 10, 12)], 1, 2, 3)).toBeNull(); // n = 3 < 4
    expect(computeUo([], 1, 2, 3)).toBeNull();
  });
});

describe('uoBoard', () => {
  const series = [
    { symbol: 'HOT', bars: uptrend },
    { symbol: 'COLD', bars: downtrend },
  ];

  it('defaults to sorting by UO descending', () => {
    const rows = uoBoard(series, 'uo', 1, 2, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['HOT', 'COLD']);
    expect(rows[0].zone).toBe('overbought');
    expect(rows[1].zone).toBe('oversold');
  });

  it('sorts by symbol', () => {
    const rows = uoBoard(series, 'symbol', 1, 2, 3);
    expect(rows.map((r) => r.symbol)).toEqual(['COLD', 'HOT']);
  });

  it('skips symbols with too little history', () => {
    const rows = uoBoard(
      [
        { symbol: 'OK', bars: uptrend },
        { symbol: 'THIN', bars: [bar(10, 8, 9), bar(12, 9, 11), bar(13, 10, 12)] },
      ],
      'uo',
      1,
      2,
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortUo', () => {
  it('orders by UO descending', () => {
    const rows = [
      { symbol: 'A', uo: 45 },
      { symbol: 'B', uo: 80 },
      { symbol: 'C', uo: 20 },
    ] as UoRow[];
    expect(sortUo(rows, 'uo').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
