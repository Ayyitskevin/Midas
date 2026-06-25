/**
 * Omega ratio — a full-distribution performance measure that, unlike Sharpe,
 * makes no normality assumption and uses every moment of the return series. At a
 * threshold τ (the minimum acceptable return, often 0) it is the ratio of the
 * probability-weighted gains above τ to the probability-weighted shortfalls
 * below it:
 *
 *     Ω(τ) = Σ max(rᵢ − τ, 0) / Σ max(τ − rᵢ, 0)
 *
 * Ω(τ) = 1 marks the break-even threshold; above 1 the upside outweighs the
 * downside. Because it integrates the whole distribution it captures the skew
 * and fat tails the variance-based ratios miss, and raising τ monotonically
 * lowers it. (Ω(0) = gain/pain = the Gain-to-Pain ratio + 1.)
 *
 * Reuses the shared simple returns and mean. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';

export interface OmegaRow {
  symbol: string;
  /** Omega ratio at the threshold; null when nothing fell below it (no downside). */
  omega: number | null;
  /** Σ max(rᵢ − τ, 0) — total upside over the threshold. */
  upside: number;
  /** Σ max(τ − rᵢ, 0) — total shortfall below the threshold. */
  downside: number;
  /** Mean period return, for context. */
  meanRet: number;
  /** Returns used. */
  n: number;
}

export type OmegaSort = 'omega' | 'meanRet' | 'symbol';

export interface OmegaInput {
  symbol: string;
  closes: number[];
}

/**
 * Omega stats for one close series at per-period threshold `threshold` (default
 * 0). Returns null with fewer than two closes. When no return fell below the
 * threshold the downside is zero and Omega is undefined (infinite), reported as
 * null.
 */
export function computeOmega(closes: number[], threshold = 0): Omit<OmegaRow, 'symbol'> | null {
  if (closes.length < 2) return null;
  const returns = toReturns(closes);
  let upside = 0;
  let downside = 0;
  for (const r of returns) {
    const d = r - threshold;
    if (d > 0) upside += d;
    else if (d < 0) downside += -d;
  }
  const omega = downside > 0 ? upside / downside : null;
  return { omega, upside, downside, meanRet: mean(returns), n: returns.length };
}

/** Omega board across a basket at a shared threshold, sorted (default Ω descending). */
export function omegaBoard(series: OmegaInput[], threshold = 0, sort: OmegaSort = 'omega'): OmegaRow[] {
  const rows: OmegaRow[] = [];
  for (const s of series) {
    const r = computeOmega(s.closes, threshold);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortOmega(rows, sort);
}

export function sortOmega(rows: OmegaRow[], sort: OmegaSort): OmegaRow[] {
  // A null Omega means "no downside" — the best possible outcome — so it sorts
  // to the top under the Omega column (+Infinity).
  const hi = (v: number | null) => (v == null ? Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'meanRet':
        return b.meanRet - a.meanRet;
      case 'omega':
      default:
        return hi(b.omega) - hi(a.omega);
    }
  });
  return out;
}
