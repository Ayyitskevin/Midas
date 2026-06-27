import { describe, it, expect } from 'vitest';
import { computeCoppock, coppockBoard, sortCoppock, type CoppockRow } from './coppock';

// Params roc1=2, roc2=1, wma=2 (weights 1,2; denom 3). Hand-computed:
//   closes [100,100,110,121]:
//     sum[i=2] = (110−100)/100·100 + (110−100)/100·100 = 20
//     sum[i=3] = (121−100)/100·100 + (121−110)/110·100 = 21 + 10 = 31
//     WMA = (1·20 + 2·31)/3 = 82/3 = 27.3333…
const a = [100, 100, 110, 121];
// Extend so the curve dips then turns back up → fresh trough (turn 'up'):
//   sum = [20, 31, −9.0909, 42.9752]; WMA series = [27.3333, 4.2727, 25.6198]
const turnUp = [100, 100, 110, 121, 110, 140];
// A steady decline → negative Coppock:
//   sum = [−26.4463, −28.1818]; WMA = (1·−26.4463 + 2·−28.1818)/3 = −27.6033
const down = [121, 110, 100, 90];

describe('computeCoppock', () => {
  it('is a linearly-weighted MA of the summed ROCs (newest weighted highest)', () => {
    const r = computeCoppock(a, 2, 1, 2)!;
    expect(r.coppock).toBeCloseTo(82 / 3, 6); // 27.3333…
    expect(r.side).toBe('up');
    expect(r.turn).toBe('none'); // only one Coppock value
    expect(r.n).toBe(4);
  });

  it('flags a fresh upward turn (trough) and a rising curve', () => {
    const r = computeCoppock(turnUp, 2, 1, 2)!;
    expect(r.coppock).toBeCloseTo(25.619835, 4);
    expect(r.prev).toBeCloseTo(4.272727, 4);
    expect(r.rising).toBe(true);
    expect(r.turn).toBe('up');
  });

  it('goes negative on a steady decline', () => {
    const r = computeCoppock(down, 2, 1, 2)!;
    expect(r.coppock).toBeCloseTo(-27.603306, 4);
    expect(r.side).toBe('down');
  });

  it('returns null with too little history', () => {
    expect(computeCoppock([100, 110, 121], 2, 1, 2)).toBeNull(); // n < max(roc) + wma
    expect(computeCoppock([], 2, 1, 2)).toBeNull();
  });
});

describe('coppockBoard', () => {
  const series = [
    { symbol: 'UP', closes: a }, // +27.33
    { symbol: 'DOWN', closes: down }, // −27.60
  ];

  it('defaults to sorting by Coppock descending', () => {
    const rows = coppockBoard(series, 'coppock', 2, 1, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].side).toBe('up');
    expect(rows[1].side).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = coppockBoard(series, 'symbol', 2, 1, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = coppockBoard(
      [
        { symbol: 'OK', closes: a },
        { symbol: 'THIN', closes: [100, 110, 121] },
      ],
      'coppock',
      2,
      1,
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCoppock', () => {
  it('orders by Coppock descending', () => {
    const rows = [
      { symbol: 'A', coppock: 5 },
      { symbol: 'B', coppock: 18 },
      { symbol: 'C', coppock: -3 },
    ] as CoppockRow[];
    expect(sortCoppock(rows, 'coppock').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
