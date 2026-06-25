/**
 * Gain-to-Pain Ratio (Jack Schwager's GPR) — the sum of all returns divided by
 * the absolute value of the sum of the losing returns. It asks a blunt question:
 * for every unit of downside you had to sit through, how much net return did you
 * collect? A GPR of 1.0 means total net gains exactly equalled the cumulative
 * pain; Schwager treats ≥ 1 as good and ≥ 2 as excellent. Unlike Sharpe it makes
 * no normality assumption — it just nets the wins against the felt losses — so it
 * is robust to the fat tails crypto returns are full of.
 *
 *     GPR = Σ rᵢ / Σ|rᵢ for rᵢ < 0|   (= gain/pain − 1, since Σrᵢ = gain − pain)
 *
 * Reuses the shared simple returns. Pure for unit testing.
 */

import { toReturns } from './correlation';

export interface GprRow {
  symbol: string;
  /** Gain-to-Pain Ratio; null when there were no losing periods (no pain). */
  gpr: number | null;
  /** Sum of all returns over the window (the GPR numerator). */
  totalReturn: number;
  /** Sum of the positive returns. */
  gain: number;
  /** Sum of the absolute losses (the GPR denominator). */
  pain: number;
  /** Count of up periods (return > 0). */
  up: number;
  /** Count of down periods (return < 0). */
  down: number;
  /** Returns used. */
  n: number;
}

export type GprSort = 'gpr' | 'totalReturn' | 'up' | 'symbol';

export interface GprInput {
  symbol: string;
  closes: number[];
}

/**
 * Gain-to-pain stats for one close series. Returns null with fewer than two
 * closes (no return). When there were no losing periods the GPR is undefined
 * (infinite upside) and reported as null.
 */
export function computeGpr(closes: number[]): Omit<GprRow, 'symbol'> | null {
  if (closes.length < 2) return null;
  const returns = toReturns(closes);
  let gain = 0;
  let pain = 0;
  let up = 0;
  let down = 0;
  for (const r of returns) {
    if (r > 0) {
      gain += r;
      up += 1;
    } else if (r < 0) {
      pain += -r;
      down += 1;
    }
  }
  const totalReturn = gain - pain;
  const gpr = pain > 0 ? totalReturn / pain : null;
  return { gpr, totalReturn, gain, pain, up, down, n: returns.length };
}

/** Gain-to-pain board across a basket, sorted (default GPR descending). */
export function gprBoard(series: GprInput[], sort: GprSort = 'gpr'): GprRow[] {
  const rows: GprRow[] = [];
  for (const s of series) {
    const r = computeGpr(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortGpr(rows, sort);
}

export function sortGpr(rows: GprRow[], sort: GprSort): GprRow[] {
  // A null GPR means "no losses" — the best possible outcome — so it sorts to
  // the top under the GPR column (+Infinity), unlike the usual null-is-worst.
  const hi = (v: number | null) => (v == null ? Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'totalReturn':
        return b.totalReturn - a.totalReturn;
      case 'up':
        return b.up / Math.max(1, b.n) - a.up / Math.max(1, a.n);
      case 'gpr':
      default:
        return hi(b.gpr) - hi(a.gpr);
    }
  });
  return out;
}
