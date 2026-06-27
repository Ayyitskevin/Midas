import { describe, it, expect } from 'vitest';
import { computeSmie, smieCross, smieBoard, sortSmie, type SmieRow } from './smie';
import { computeTsi } from './tsi';

describe('smieCross', () => {
  it('flags a bull cross when the histogram turns positive', () => {
    expect(smieCross(-1, 1)).toBe('bull');
    expect(smieCross(0, 1)).toBe('bull');
  });
  it('flags a bear cross when the histogram turns negative', () => {
    expect(smieCross(1, -1)).toBe('bear');
    expect(smieCross(0, -1)).toBe('bear');
  });
  it('is none when the histogram keeps its sign', () => {
    expect(smieCross(1, 2)).toBe('none');
    expect(smieCross(-2, -1)).toBe('none');
  });
});

describe('computeSmie', () => {
  // Workflow-verified example, reduced params long=2, short=2, signal=2.
  //   closes = [10, 11, 13, 12, 14, 15]
  //   smiSeries  = [100, 100, 31.428571, 62.790698, 78.247734]
  //   signalSeries = [100, 100, 54.285714, 59.955703, 72.150390]
  //   histSeries = [0, 0, -22.857143, 2.834994, 6.097344]
  it('matches the hand-computed example (no fresh cross, momentum already positive)', () => {
    const r = computeSmie([10, 11, 13, 12, 14, 15], 2, 2, 2)!;
    expect(r).not.toBeNull();
    expect(r.smi).toBeCloseTo(78.24773413897282, 9);
    expect(r.signal).toBeCloseTo(72.15039049648759, 9);
    expect(r.hist).toBeCloseTo(6.097343642485215, 9);
    expect(r.cross).toBe('none'); // hist was already > 0 on the prior bar
    expect(r.side).toBe('pos');
  });

  it('detects a fresh bull cross as the histogram flips positive', () => {
    // One bar earlier the histogram was −22.86 → +2.83: a signal-line cross up.
    const r = computeSmie([10, 11, 13, 12, 14], 2, 2, 2)!;
    expect(r.hist).toBeCloseTo(2.83499446290144, 9);
    expect(r.cross).toBe('bull');
  });

  it('equals the verified TSI building block for the same params', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.2);
    const e = computeSmie(closes, 25, 13, 7)!;
    const t = computeTsi(closes, 25, 13, 7)!;
    expect(e.smi).toBeCloseTo(t.tsi, 9);
    expect(e.signal).toBeCloseTo(t.signal, 9);
    expect(e.hist).toBeCloseTo(t.hist, 9);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeSmie([], 20)).toBeNull();
    // long + short + 1 closes needed.
    expect(computeSmie([1, 2, 3, 4], 2, 2, 2)).toBeNull();
    expect(computeSmie([1, 2, 3, 4, 5], 2, 2, 2)).not.toBeNull();
    expect(computeSmie(Array.from({ length: 40 }, (_, i) => i), 0)).toBeNull();
    expect(computeSmie(Array.from({ length: 40 }, (_, i) => i), 20, 5, 0)).toBeNull();
  });

  it('works with default params on a longer series', () => {
    const r = computeSmie(Array.from({ length: 60 }, (_, i) => 100 + i))!;
    expect(r).not.toBeNull();
    expect(['bull', 'bear', 'none']).toContain(r.cross);
    expect(r.side).toBe(r.smi >= 0 ? 'pos' : 'neg');
  });
});

describe('smieBoard / sortSmie', () => {
  const rows: SmieRow[] = [
    { symbol: 'B/USDT', smi: -10, signal: -8, hist: -2, cross: 'bear', side: 'neg', n: 60 },
    { symbol: 'A/USDT', smi: 30, signal: 25, hist: 5, cross: 'bull', side: 'pos', n: 60 },
    { symbol: 'C/USDT', smi: 5, signal: 6, hist: -1, cross: 'none', side: 'pos', n: 60 },
  ];

  it('sorts by the indicator descending by default', () => {
    expect(sortSmie(rows, 'smi').map((r) => r.smi)).toEqual([30, 5, -10]);
  });

  it('sorts by histogram and by symbol', () => {
    expect(sortSmie(rows, 'hist').map((r) => r.hist)).toEqual([5, -1, -2]);
    expect(sortSmie(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = smieBoard(
      [
        { symbol: 'OK/USDT', closes: [10, 11, 13, 12, 14, 15, 16] },
        { symbol: 'THIN/USDT', closes: [1, 2, 3] },
      ],
      'smi',
      2,
      2,
      2,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
