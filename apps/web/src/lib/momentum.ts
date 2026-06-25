/**
 * Momentum / relative-strength math — pure and offline. Returns over several
 * look-backs are computed from a daily close series; a composite score (the
 * mean of the available look-backs) gives an at-a-glance strength ranking.
 */

/** Percentage return of the last close versus `bars` candles earlier; null if undefined. */
export function pctReturn(closes: readonly number[], bars: number): number | null {
  if (bars <= 0 || closes.length < bars + 1) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - bars];
  if (!(prev > 0) || !(last > 0)) return null;
  return (last / prev - 1) * 100;
}

export interface MomentumStats {
  lastClose: number;
  /** 1 daily bar. */
  r24h: number | null;
  /** 7 daily bars. */
  r7d: number | null;
  /** 30 daily bars. */
  r30d: number | null;
  /** Mean of the available look-back returns; null if none. */
  score: number | null;
}

export function computeMomentum(closes: readonly number[]): MomentumStats {
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : 0;
  const r24h = pctReturn(closes, 1);
  const r7d = pctReturn(closes, 7);
  const r30d = pctReturn(closes, 30);

  const present = [r24h, r7d, r30d].filter((v): v is number => v != null);
  const score = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;

  return { lastClose, r24h, r7d, r30d, score };
}
