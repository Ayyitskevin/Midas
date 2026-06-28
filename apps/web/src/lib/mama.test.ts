import { describe, it, expect } from 'vitest';
import { computeMama, mamaBoard, sortMama, type MamaBar, type MamaRow } from './mama';

// Build a bar whose median (H+L)/2 equals `mid` (the indicator's price input).
const bar = (mid: number): MamaBar => ({ high: mid + 1, low: mid - 1, close: mid });

describe('computeMama', () => {
  it('rides a sustained up-trend with MAMA leading above FAMA', () => {
    // price = (H+L)/2 = 100 + i. MAMA adapts faster so it tracks just under a
    // rising price while FAMA (half alpha) lags further below — gap strictly > 0
    // (which a full-alpha FAMA bug would collapse to 0).
    const up: MamaBar[] = Array.from({ length: 150 }, (_, i) => bar(100 + i));
    const r = computeMama(up)!;
    expect(r).not.toBeNull();
    expect(r.alpha).toBeGreaterThanOrEqual(0.05 - 1e-12);
    expect(r.alpha).toBeLessThanOrEqual(0.5 + 1e-12);
    const price = 100 + 149;
    expect(r.mama).toBeLessThan(price); // lags below a rising price
    expect(r.mama).toBeGreaterThan(price - 6); // but tracks closely
    expect(r.fama).toBeLessThan(r.mama); // FAMA lags further (half alpha)
    expect(r.dir).toBe('bull');
    expect(r.gapPct).toBeGreaterThan(0.3);
    expect(r.cross).toBe('none');
    expect(r.n).toBe(150);
  });

  it('flips bearish with MAMA below FAMA on a sustained down-trend', () => {
    const down: MamaBar[] = Array.from({ length: 150 }, (_, i) => bar(300 - i));
    const r = computeMama(down)!;
    const price = 300 - 149;
    expect(r.mama).toBeGreaterThan(price); // lags above a falling price
    expect(r.mama).toBeLessThan(price + 6);
    expect(r.fama).toBeGreaterThan(r.mama);
    expect(r.dir).toBe('bear');
    expect(r.gapPct).toBeLessThan(-0.3);
  });

  it('converges MAMA = FAMA = price on a flat series', () => {
    const flat: MamaBar[] = Array.from({ length: 60 }, () => bar(100));
    const r = computeMama(flat)!;
    expect(r.mama).toBeCloseTo(100, 9);
    expect(r.fama).toBeCloseTo(100, 9);
    expect(r.gapPct).toBeCloseTo(0, 9);
    expect(r.alpha).toBeCloseTo(0.5, 9);
  });

  it('keeps alpha within [slowLimit, fastLimit] and MAMA finite on a noisy cycle', () => {
    const wave: MamaBar[] = Array.from({ length: 200 }, (_, i) =>
      bar(100 + 10 * Math.sin((2 * Math.PI * i) / 20)),
    );
    const r = computeMama(wave)!;
    expect(r.alpha).toBeGreaterThanOrEqual(0.05 - 1e-12);
    expect(r.alpha).toBeLessThanOrEqual(0.5 + 1e-12);
    expect(Number.isFinite(r.mama)).toBe(true);
    expect(r.mama).toBeGreaterThan(85);
    expect(r.mama).toBeLessThan(115);
  });

  it('returns null on too little history or bad params', () => {
    const up: MamaBar[] = Array.from({ length: 80 }, (_, i) => bar(100 + i));
    expect(computeMama([], 0.5, 0.05)).toBeNull();
    expect(computeMama(up.slice(0, 39))).toBeNull(); // < 40 bars
    expect(computeMama(up.slice(0, 40))).not.toBeNull();
    expect(computeMama(up, 0.05, 0.5)).toBeNull(); // fastLimit < slowLimit
    expect(computeMama(up, 0, 0.05)).toBeNull();
  });
});

describe('mamaBoard / sortMama', () => {
  const rows: MamaRow[] = [
    { symbol: 'B/USDT', mama: 100, fama: 99, dir: 'bull', gapPct: 1, cross: 'none', alpha: 0.3, n: 200 },
    { symbol: 'A/USDT', mama: 50, fama: 48, dir: 'bull', gapPct: 4, cross: 'toBull', alpha: 0.5, n: 200 },
    { symbol: 'C/USDT', mama: 3, fama: 3.1, dir: 'bear', gapPct: -3, cross: 'toBear', alpha: 0.2, n: 200 },
  ];

  it('sorts by gap% descending by default (strongest bull separation first)', () => {
    expect(sortMama(rows, 'gap').map((r) => r.gapPct)).toEqual([4, 1, -3]);
  });

  it('sorts by symbol', () => {
    expect(sortMama(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const up: MamaBar[] = Array.from({ length: 60 }, (_, i) => bar(100 + i));
    const board = mamaBoard(
      [
        { symbol: 'OK/USDT', bars: up },
        { symbol: 'THIN/USDT', bars: up.slice(0, 20) },
      ],
      'gap',
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
