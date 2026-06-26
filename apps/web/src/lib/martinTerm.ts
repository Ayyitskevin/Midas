/**
 * Martin ratio term structure — the Ulcer Performance Index (annualized return ÷
 * Ulcer Index) across several trailing windows, so a name's drawdown-adjusted
 * return is read as a *curve over horizon* rather than one number.
 *
 *     Martin = annualized return / Ulcer Index   (over the trailing W closes)
 *
 * The single-window ULCER board tells you where a name stands today; the term
 * structure tells you the trajectory — a Martin that climbs from the 1Y to the 1M
 * column is a name whose risk-adjusted return is improving as its old drawdowns
 * roll off, while one that falls is decaying. A null cell means the window had no
 * drawdown at all (an infinite, undefined Martin — the best possible).
 *
 * Reuses the tested ulcer lib's computeUlcer (which already nets annualized return
 * against the Ulcer Index), just evaluated over each trailing slice. Pure for unit
 * testing.
 */

import { computeUlcer } from './ulcer';

export interface MartinTermRow {
  symbol: string;
  /** Martin ratio per lookback window (parallel to the windows array); null when the window had no drawdown (∞) or too little history. */
  martins: (number | null)[];
  /** Closes available for this symbol. */
  n: number;
}

export interface MartinTermInput {
  symbol: string;
  closes: number[];
}

/** A window index to sort by, or 'symbol'. */
export type MartinTermSort = number | 'symbol';

/**
 * Martin ratio over the trailing `window` closes (the whole series if shorter).
 * Null when fewer than three closes are available or the window never drew down.
 */
export function martinForWindow(closes: number[], window: number, periodsPerYear: number): number | null {
  const slice = closes.length > window ? closes.slice(-window) : closes;
  const u = computeUlcer(slice, periodsPerYear);
  return u ? u.martin : null;
}

/**
 * Build a Martin term-structure board: each symbol's Martin ratio across the
 * given trailing windows. Symbols with fewer than three closes are dropped.
 */
export function martinTermBoard(
  series: MartinTermInput[],
  windows: number[],
  periodsPerYear: number,
  sort: MartinTermSort = windows.length - 1, // default: sort by the longest window
): MartinTermRow[] {
  const rows: MartinTermRow[] = [];
  for (const s of series) {
    if (s.closes.length < 3) continue;
    rows.push({
      symbol: s.symbol,
      martins: windows.map((w) => martinForWindow(s.closes, w, periodsPerYear)),
      n: s.closes.length,
    });
  }
  return sortMartinTerm(rows, sort);
}

export function sortMartinTerm(rows: MartinTermRow[], sort: MartinTermSort): MartinTermRow[] {
  // A null Martin (no drawdown in the window) is the best case but cannot be
  // ordered numerically; sink it so the finite, comparable values rank cleanly.
  const lo = (v: number | null | undefined) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    if (sort === 'symbol') return a.symbol.localeCompare(b.symbol);
    return lo(b.martins[sort]) - lo(a.martins[sort]);
  });
  return out;
}
