import { describe, it, expect } from 'vitest';
import { ulcerIndex, computeUlcer, ulcerBoard, sortUlcer, type UlcerRow } from './ulcer';

describe('ulcerIndex', () => {
  it('is zero for a flat or monotonically rising series', () => {
    expect(ulcerIndex([100, 100, 100])).toBe(0);
    expect(ulcerIndex([100, 110, 121, 130])).toBe(0);
    expect(ulcerIndex([])).toBe(0);
  });

  it('is the RMS of peak-relative drawdowns', () => {
    // [100, 90, 100] → dd = [0, -0.1, 0] → √(0.01/3).
    expect(ulcerIndex([100, 90, 100])).toBeCloseTo(Math.sqrt(0.01 / 3), 12);
    // [100, 80, 100] → dd = [0, -0.2, 0] → √(0.04/3).
    expect(ulcerIndex([100, 80, 100])).toBeCloseTo(Math.sqrt(0.04 / 3), 12);
    // [100, 50] → dd = [0, -0.5] → √(0.25/2).
    expect(ulcerIndex([100, 50])).toBeCloseTo(Math.sqrt(0.25 / 2), 12);
  });

  it('uses the running peak, so a lower-low deepens the drawdown', () => {
    // [100, 90, 80] → dd = [0, -0.1, -0.2] → √((0.01+0.04)/3).
    expect(ulcerIndex([100, 90, 80])).toBeCloseTo(Math.sqrt((0.01 + 0.04) / 3), 12);
  });

  it('never exceeds the magnitude of the max drawdown', () => {
    const closes = [100, 95, 80, 90, 70, 110, 100];
    const ui = ulcerIndex(closes);
    const maxDD = Math.abs(Math.min(...closes.map((_, i) => {
      const peak = Math.max(...closes.slice(0, i + 1));
      return closes[i] / peak - 1;
    })));
    expect(ui).toBeLessThanOrEqual(maxDD + 1e-12);
  });
});

describe('computeUlcer', () => {
  it('returns null with fewer than three closes', () => {
    expect(computeUlcer([100, 90], 365)).toBeNull();
    expect(computeUlcer([100], 365)).toBeNull();
  });

  it('has zero ulcer and a null Martin ratio for a monotonic riser', () => {
    const r = computeUlcer([100, 110, 121], 365)!;
    expect(r.ulcer).toBe(0);
    expect(r.maxDD).toBe(0);
    expect(r.martin).toBeNull();
    expect(r.annReturn).toBeCloseTo(0.1 * 365, 9); // mean(0.1,0.1) × 365
  });

  it('computes Martin = annReturn / ulcer with a drawdown present', () => {
    const closes = [100, 110, 99, 121, 108];
    const r = computeUlcer(closes, 365)!;
    expect(r.ulcer).toBeGreaterThan(0);
    expect(r.martin).toBeCloseTo(r.annReturn / r.ulcer, 12);
    expect(r.maxDD).toBeGreaterThan(0);
    // Ulcer is gentler than the single worst drawdown.
    expect(r.ulcer).toBeLessThanOrEqual(r.maxDD + 1e-12);
  });
});

describe('ulcerBoard / sortUlcer', () => {
  const calm = [100, 101, 100, 102, 101, 103, 102, 104]; // shallow dips
  const ouch = [100, 80, 95, 70, 90, 60, 85, 100]; // deep, long underwater
  const rise = [100, 102, 104, 106, 108, 110, 112, 114]; // monotonic → null martin

  it('drops too-short series and defaults to Martin descending', () => {
    const board = ulcerBoard(
      [
        { symbol: 'CALM', closes: calm },
        { symbol: 'OUCH', closes: ouch },
        { symbol: 'SHORT', closes: [100, 90] },
      ],
      365,
    );
    expect(board.map((r) => r.symbol).sort()).toEqual(['CALM', 'OUCH']);
    // Best Martin first (null sinks to the bottom via -Infinity).
    expect(board[0].martin! >= (board[1].martin ?? -Infinity)).toBe(true);
  });

  it('sorts by ulcer with the most pain first', () => {
    const board = ulcerBoard(
      [
        { symbol: 'CALM', closes: calm },
        { symbol: 'OUCH', closes: ouch },
      ],
      365,
      'ulcer',
    );
    expect(board[0].symbol).toBe('OUCH'); // higher ulcer
    expect(board[0].ulcer).toBeGreaterThan(board[1].ulcer);
  });

  it('sinks a null Martin (no drawdown) to the bottom', () => {
    const rows: UlcerRow[] = ulcerBoard(
      [
        { symbol: 'RISE', closes: rise },
        { symbol: 'OUCH', closes: ouch },
      ],
      365,
      'martin',
    );
    // RISE has ulcer 0 / null martin; despite zero pain it sinks under the
    // convention that null sorts last.
    expect(rows[rows.length - 1].symbol).toBe('RISE');
  });

  it('sorts by symbol alphabetically', () => {
    const board = sortUlcer(
      [
        { symbol: 'ZZZ', ulcer: 0.1, maxDD: 0.2, annReturn: 0.5, martin: 5, n: 10 },
        { symbol: 'AAA', ulcer: 0.2, maxDD: 0.3, annReturn: 0.4, martin: 2, n: 10 },
      ],
      'symbol',
    );
    expect(board.map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
