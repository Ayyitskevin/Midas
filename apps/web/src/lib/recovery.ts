/**
 * Drawdown recovery — how long the *pain lasts*, not just how deep it goes. A
 * drawdown board ranks names by trough depth; this one ranks them by time spent
 * underwater and how quickly they heal. For each name we measure:
 *
 *   - current: trailing periods still underwater (0 at a fresh high)
 *   - longest: the longest underwater stretch over the window
 *   - avgRecovery: average length of the drawdown episodes that DID recover
 *     (peak → back to a new high); null when none have recovered yet
 *
 * Two names with the same max drawdown are not equal: one that claws back to
 * highs in a week is a very different hold from one that grinds underwater for
 * months. A name still underwater now (current > 0) is in an unresolved drawdown.
 *
 * Reuses the shared peak-relative drawdown series, so `current` and `longest`
 * line up exactly with the drawdown board's underwater / longest-underwater
 * fields. Periods are in candles (days on a daily series). Pure for unit testing.
 */

import { drawdownSeries } from './drawdown';

export interface RecoveryStat {
  /** Trailing periods still underwater (0 at a fresh high). */
  current: number;
  /** Longest underwater run over the window. */
  longest: number;
  /** Average length of underwater runs that fully recovered; null when none recovered. */
  avgRecovery: number | null;
  /** Count of completed (recovered) drawdown episodes. */
  recovered: number;
  /** True when the series is currently in an unresolved drawdown. */
  underwaterNow: boolean;
}

export interface RecoveryRow extends RecoveryStat {
  symbol: string;
  /** Worst drawdown over the window (positive fraction, context). */
  maxDD: number;
  /** Closes used. */
  n: number;
}

export type RecoverySort = 'longest' | 'current' | 'avgRecovery' | 'maxDD' | 'symbol';

export interface RecoveryInput {
  symbol: string;
  closes: number[];
}

/**
 * Underwater / recovery statistics from a close series. An underwater run is a
 * maximal stretch below the running peak; a run that ends by reaching a new high
 * is a "recovered" episode, while a run still open at the end of the series is the
 * current (unresolved) drawdown and is NOT counted as recovered.
 */
export function recoveryStats(closes: number[]): RecoveryStat {
  const dd = drawdownSeries(closes);
  const recoveredRuns: number[] = [];
  let run = 0;
  let longest = 0;
  for (const d of dd) {
    if (d < 0) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      if (run > 0) recoveredRuns.push(run); // run ended by recovering to a new high
      run = 0;
    }
  }
  // A run still open at the end is the current drawdown — ongoing, not recovered.
  const current = run;
  const avgRecovery =
    recoveredRuns.length > 0 ? recoveredRuns.reduce((a, b) => a + b, 0) / recoveredRuns.length : null;
  return { current, longest, avgRecovery, recovered: recoveredRuns.length, underwaterNow: run > 0 };
}

/** Drawdown-recovery stats for one close series; null with fewer than three closes. */
export function computeRecovery(closes: number[]): Omit<RecoveryRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const stat = recoveryStats(closes);
  const dd = drawdownSeries(closes);
  let worst = 0;
  for (const d of dd) if (d < worst) worst = d;
  return { ...stat, maxDD: worst < 0 ? -worst : 0, n: closes.length };
}

/** Drawdown-recovery board across a basket, sorted (default longest underwater descending). */
export function recoveryBoard(series: RecoveryInput[], sort: RecoverySort = 'longest'): RecoveryRow[] {
  const rows: RecoveryRow[] = [];
  for (const s of series) {
    const r = computeRecovery(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortRecovery(rows, sort);
}

export function sortRecovery(rows: RecoveryRow[], sort: RecoverySort): RecoveryRow[] {
  const hi = (v: number | null) => (v == null ? -Infinity : v); // null avgRecovery sinks
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'current':
        return b.current - a.current; // most currently underwater first
      case 'avgRecovery':
        return hi(b.avgRecovery) - hi(a.avgRecovery);
      case 'maxDD':
        return b.maxDD - a.maxDD;
      case 'longest':
      default:
        return b.longest - a.longest; // longest underwater first
    }
  });
  return out;
}
