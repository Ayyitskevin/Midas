/**
 * Burke ratio (Gibbons Burke, 1994) — a drawdown risk-adjusted return whose risk
 * term is the *Euclidean norm* of the drawdown-episode depths: the square root of
 * the summed squared troughs.
 *
 *     Burke = annualized return / √( Σ over episodes troughᵢ² )
 *
 * Squaring makes a deep drawdown hurt far more than a shallow one, and *summing*
 * the squares (rather than averaging them, as Sterling does) means more frequent
 * drawdowns also lift the risk term — so Burke rewards books that are both deep-
 * and frequent-drawdown-light, not merely shallow on average.
 *
 * Where it sits among the drawdown family: Calmar divides by the single worst
 * drawdown; Sterling by the average episode depth (+10%); Ulcer / Martin by the
 * RMS of *per-period* drawdowns (so it is duration-sensitive). Burke is the
 * root-sum-square of *episode* depths — depth- and frequency-sensitive. Using the
 * sum (not the mean) is what keeps it distinct from the Ulcer/Martin RMS.
 *
 * Reuses the shared simple returns, mean, and the drawdown-episode troughs from
 * the Sterling lib so the numbers line up with the drawdown / Calmar / Sterling /
 * Ulcer / Pain boards. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { drawdownSeries } from './drawdown';
import { drawdownTroughs } from './sterling';

export interface BurkeRow {
  symbol: string;
  /** annReturn ÷ drawdown deviation; null when the name never drew down. */
  burke: number | null;
  /** Burke risk term: √(Σ troughᵢ²) over drawdown episodes (positive fraction). */
  ddDeviation: number;
  /** Worst single drawdown over the period (positive fraction, context). */
  maxDD: number;
  /** Annualized return (arithmetic mean × periods/yr), as a fraction. */
  annReturn: number;
  /** Number of distinct drawdown episodes. */
  episodes: number;
  /** Returns used. */
  n: number;
}

export type BurkeSort = 'burke' | 'ddDeviation' | 'annReturn' | 'symbol';

export interface BurkeInput {
  symbol: string;
  closes: number[];
}

/**
 * Burke drawdown deviation: √(Σ troughᵢ²) over the distinct drawdown episodes,
 * as a positive fraction. Zero for a monotonically rising or flat series. With
 * two or more episodes it exceeds the deepest single trough, since the squares
 * accumulate.
 */
export function drawdownDeviation(closes: number[]): number {
  const troughs = drawdownTroughs(closes); // negative depths, one per episode
  let sumSq = 0;
  for (const t of troughs) sumSq += t * t;
  return Math.sqrt(sumSq);
}

/**
 * Burke stats for one close series. Returns null with fewer than three closes. A
 * name that never drew down has a zero deviation and an undefined (null) Burke
 * ratio, since the denominator is zero.
 */
export function computeBurke(
  closes: number[],
  periodsPerYear: number,
): Omit<BurkeRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const returns = toReturns(closes);
  const annReturn = mean(returns) * periodsPerYear;

  const troughs = drawdownTroughs(closes); // negative depths
  let sumSq = 0;
  for (const t of troughs) sumSq += t * t;
  const ddDeviation = Math.sqrt(sumSq);

  const dd = drawdownSeries(closes);
  let worst = 0;
  for (const d of dd) if (d < worst) worst = d;
  const maxDD = worst < 0 ? -worst : 0;

  const burke = ddDeviation > 0 ? annReturn / ddDeviation : null;
  return { burke, ddDeviation, maxDD, annReturn, episodes: troughs.length, n: returns.length };
}

/** Burke board across a basket, sorted (default Burke ratio descending). */
export function burkeBoard(
  series: BurkeInput[],
  periodsPerYear: number,
  sort: BurkeSort = 'burke',
): BurkeRow[] {
  const rows: BurkeRow[] = [];
  for (const s of series) {
    const r = computeBurke(s.closes, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortBurke(rows, sort);
}

export function sortBurke(rows: BurkeRow[], sort: BurkeSort): BurkeRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v); // null Burke sinks last
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'ddDeviation':
        return b.ddDeviation - a.ddDeviation; // most drawdown risk first
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'burke':
      default:
        return lo(b.burke) - lo(a.burke); // best risk-adjusted first
    }
  });
  return out;
}
