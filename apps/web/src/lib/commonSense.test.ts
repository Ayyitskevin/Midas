import { describe, it, expect } from 'vitest';
import { computeCsr, csrBoard, sortCsr } from './commonSense';
import { computeTail } from './tailRatio';
import { computeGpr } from './gainToPain';

describe('computeCsr', () => {
  it('is exactly the product of the tail-ratio and gain-to-pain components', () => {
    // a mixed series: net positive, with both up and down moves.
    const closes = [100, 120, 114, 131.1, 127.167, 139.8837]; // returns [.2,-.05,.15,-.03,.1]
    const r = computeCsr(closes)!;
    const tail = computeTail(closes)!;
    const gp = computeGpr(closes)!;
    expect(r.tailRatio).toBe(tail.tailRatio);
    expect(r.gpr).toBe(gp.gpr);
    expect(r.csr).toBeCloseTo(tail.tailRatio! * gp.gpr!, 12);
    expect(r.csr).toBeGreaterThan(0); // fat-ish right tail × net gain
    expect(r.n).toBe(5);
  });

  it('is negative when the record is a net loss (gain-to-pain < 0)', () => {
    const closes = [100, 90, 95, 85]; // returns [-.1, .0556, -.1053] → net loss
    const r = computeCsr(closes)!;
    expect(r.gpr).toBeLessThan(0);
    expect(r.tailRatio).toBeGreaterThan(0);
    expect(r.csr).toBeLessThan(0);
    expect(r.csr).toBeCloseTo(r.tailRatio! * r.gpr!, 12);
  });

  it('is null when there are no losing periods (gain-to-pain undefined)', () => {
    const closes = [100, 110, 121, 133.1]; // monotone riser, returns all +0.1
    const r = computeCsr(closes)!;
    expect(r.tailRatio).toBeCloseTo(1, 12); // |0.1| / |0.1|
    expect(r.gpr).toBeNull(); // no pain
    expect(r.csr).toBeNull();
  });

  it('returns null with fewer than three closes', () => {
    expect(computeCsr([100, 110])).toBeNull();
    expect(computeCsr([100])).toBeNull();
    expect(computeCsr([])).toBeNull();
  });
});

describe('csrBoard / sortCsr', () => {
  const series = [
    { symbol: 'HOT', closes: [100, 120, 114, 131.1, 127.167, 139.8837] }, // csr > 0
    { symbol: 'COLD', closes: [100, 90, 95, 85] }, // csr < 0 (net loss)
    { symbol: 'RISER', closes: [100, 110, 121, 133.1] }, // gpr null → csr null
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('filters short series, ranks by CSR desc, sinks null to the bottom', () => {
    const board = csrBoard(series);
    expect(board.map((r) => r.symbol)).toEqual(['HOT', 'COLD', 'RISER']);
    expect(board.find((r) => r.symbol === 'HOT')!.csr).toBeGreaterThan(0);
    expect(board.find((r) => r.symbol === 'COLD')!.csr).toBeLessThan(0);
    expect(board.find((r) => r.symbol === 'RISER')!.csr).toBeNull();
  });

  it('sorts by symbol', () => {
    const board = csrBoard(series);
    expect(sortCsr(board, 'symbol').map((r) => r.symbol)).toEqual(['COLD', 'HOT', 'RISER']);
  });

  it('floats a no-loss name (null GPR) to the top under the GPR column', () => {
    const board = sortCsr(csrBoard(series), 'gpr');
    expect(board[0].symbol).toBe('RISER'); // null gpr = "no losses" = best
  });
});
