import { describe, it, expect } from 'vitest';
import { computeInfoRatio, infoBoard, sortInfo, type InfoRow } from './informationRatio';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('computeInfoRatio', () => {
  it('divides active return by tracking error', () => {
    // asset − bench = [.01, 0, .02, -.01] → mean .005, stdev √0.000125.
    const r = computeInfoRatio([0.02, 0.01, 0.03, 0.0], [0.01, 0.01, 0.01, 0.01], 1)!;
    expect(r.activeReturn).toBeCloseTo(0.005, 12);
    expect(r.trackingError).toBeCloseTo(Math.sqrt(0.000125), 12);
    expect(r.infoRatio).toBeCloseTo(0.005 / Math.sqrt(0.000125), 9);
  });

  it('annualizes so IR equals active return ÷ tracking error', () => {
    const r = computeInfoRatio([0.02, 0.01, 0.03, 0.0], [0.01, 0.01, 0.01, 0.01], 252)!;
    expect(r.infoRatio).toBeCloseTo(r.activeReturn / r.trackingError, 9);
  });

  it('is negative when the asset consistently lags the benchmark', () => {
    const r = computeInfoRatio([0.0, -0.01, 0.0, -0.01], [0.02, 0.02, 0.02, 0.02], 1)!;
    expect(r.activeReturn).toBeLessThan(0);
    expect(r.infoRatio!).toBeLessThan(0);
  });

  it('returns a null ratio when the asset tracks the benchmark exactly', () => {
    const r = computeInfoRatio([0.01, 0.02, 0.03], [0.01, 0.02, 0.03], 1)!;
    expect(r.trackingError).toBe(0);
    expect(r.infoRatio).toBeNull();
  });

  it('returns null with fewer than two points', () => {
    expect(computeInfoRatio([0.01], [0.01], 1)).toBeNull();
  });
});

describe('infoBoard / sortInfo', () => {
  const btc = fromReturns([0.01, 0.01, 0.01, 0.01]);
  const winner = fromReturns([0.03, 0.02, 0.04, 0.02]); // beats BTC
  const laggard = fromReturns([-0.01, -0.02, 0.0, -0.01]); // trails BTC

  it('omits the benchmark and ranks the outperformer first', () => {
    const board = infoBoard(
      [
        { symbol: 'BTC', closes: btc },
        { symbol: 'WIN', closes: winner },
        { symbol: 'LAG', closes: laggard },
      ],
      'BTC',
      1,
    );
    expect(board.map((r) => r.symbol)).toEqual(['WIN', 'LAG']); // BTC omitted, sorted by IR
    expect(board[0].infoRatio!).toBeGreaterThan(0);
    expect(board[1].infoRatio!).toBeLessThan(0);
  });

  it('returns [] when the benchmark series is missing', () => {
    expect(infoBoard([{ symbol: 'WIN', closes: winner }], 'BTC', 1)).toEqual([]);
  });

  it('sinks a null IR to the bottom and sorts by symbol', () => {
    const rows: InfoRow[] = [
      { symbol: 'ZZZ', activeReturn: 0.1, trackingError: 0.2, infoRatio: 0.5, n: 50 },
      { symbol: 'AAA', activeReturn: 0.0, trackingError: 0, infoRatio: null, n: 50 },
    ];
    expect(sortInfo(rows, 'infoRatio')[1].symbol).toBe('AAA'); // null sinks last
    expect(sortInfo(rows, 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
