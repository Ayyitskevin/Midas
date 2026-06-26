/**
 * Up/down streaks — the raw run-length behaviour of a name's daily returns. Where
 * the ratio boards average everything away, this keeps the *sequence*: how many
 * up or down days in a row right now, the longest winning and losing runs over
 * the window, and the share of up days.
 *
 * Long streaks are momentum-persistence and capitulation tells: a name on a long
 * up run is trending hard (or stretched), a long down run is bleeding (or near
 * exhaustion), and a high up-day share with only modest gains is the classic
 * grind-up signature. The current streak is signed — positive for an up run,
 * negative for a down run, zero when the latest day was flat.
 *
 * A flat day (exactly zero return) breaks both runs and counts as neither up nor
 * down. Reuses the shared simple returns. Pure for unit testing.
 */

import { toReturns } from './correlation';

export interface StreakRow {
  symbol: string;
  /** Current run length, signed: +N = N up days in a row, −N = N down days, 0 when the last day was flat. */
  current: number;
  /** Longest consecutive up-day run over the window. */
  longestUp: number;
  /** Longest consecutive down-day run over the window. */
  longestDown: number;
  /** Fraction of up days (return > 0). */
  upPct: number;
  /** Returns used. */
  n: number;
}

export type StreakSort = 'current' | 'longestUp' | 'longestDown' | 'upPct' | 'symbol';

export interface StreakInput {
  symbol: string;
  closes: number[];
}

/** Up/down streak stats for one close series; null with fewer than two closes. */
export function computeStreaks(closes: number[]): Omit<StreakRow, 'symbol'> | null {
  if (closes.length < 2) return null;
  const returns = toReturns(closes);
  if (returns.length === 0) return null;

  let longestUp = 0;
  let longestDown = 0;
  let runUp = 0;
  let runDown = 0;
  let up = 0;
  for (const r of returns) {
    if (r > 0) {
      up += 1;
      runUp += 1;
      runDown = 0;
      if (runUp > longestUp) longestUp = runUp;
    } else if (r < 0) {
      runDown += 1;
      runUp = 0;
      if (runDown > longestDown) longestDown = runDown;
    } else {
      runUp = 0; // a flat day breaks both runs
      runDown = 0;
    }
  }

  // Current streak: walk back from the end, signed by the latest day's direction.
  let current = 0;
  const last = returns[returns.length - 1];
  if (last > 0) {
    for (let i = returns.length - 1; i >= 0 && returns[i] > 0; i--) current += 1;
  } else if (last < 0) {
    for (let i = returns.length - 1; i >= 0 && returns[i] < 0; i--) current -= 1;
  }

  return { current, longestUp, longestDown, upPct: up / returns.length, n: returns.length };
}

/** Streak board across a basket, sorted (default current streak descending). */
export function streakBoard(series: StreakInput[], sort: StreakSort = 'current'): StreakRow[] {
  const rows: StreakRow[] = [];
  for (const s of series) {
    const r = computeStreaks(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortStreaks(rows, sort);
}

export function sortStreaks(rows: StreakRow[], sort: StreakSort): StreakRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'longestUp':
        return b.longestUp - a.longestUp;
      case 'longestDown':
        return b.longestDown - a.longestDown;
      case 'upPct':
        return b.upPct - a.upPct;
      case 'current':
      default:
        return b.current - a.current; // hottest up-streak first, deepest down-streak last
    }
  });
  return out;
}
