/**
 * TD Sequential — TD Countdown (TDC) screener helpers.
 *
 * The Countdown is the second phase of Tom DeMark's TD Sequential, begun once a
 * TD Setup completes (9). Unlike the Setup's consecutive count, the Countdown
 * accumulates qualifying bars that need NOT be consecutive, toward 13:
 *
 *   TD Buy Countdown  — armed by a completed buy setup; a bar counts when
 *                       close ≤ low[2 bars ago]. 13 marks deeper downside exhaustion.
 *   TD Sell Countdown — armed by a completed sell setup; a bar counts when
 *                       close ≥ high[2 bars ago]. 13 marks upside exhaustion.
 *
 * Bar-13 qualifier (DeMark's deferral): the 13th count only lands when the bar's
 * low ≤ the close of countdown bar 8 (sell: the bar's high ≥ countdown bar 8's
 * close). Until then the count holds at 12 ("deferred"). An opposite-direction
 * setup completing cancels the active countdown and arms the other side; a
 * same-direction setup completing leaves an active countdown running.
 *
 * The setup arming reuses the same close-vs-close[4 ago] streak (clamped at 9) as
 * the TD Setup board. Counts compare closes against highs/lows, so the value is
 * scale-free and ranks cleanly across symbols. Pure and synchronous.
 */

import type { TdBar } from './tdSetup';

export type { TdBar };

export type TdCountdownDir = 'buy' | 'sell' | 'none';

export interface TdCountdownStats {
  /** Direction of the active countdown. */
  direction: TdCountdownDir;
  /** Active countdown count 0–13. */
  count: number;
  /** The count has reached 13 (countdown complete). */
  completed: boolean;
  /** Held at 12 awaiting the bar-13 low/high-vs-bar-8-close qualifier. */
  deferred: boolean;
  /** Number of bars supplied. */
  n: number;
}

export interface TdCountdownRow extends TdCountdownStats {
  symbol: string;
}

export type TdCountdownSort = 'count' | 'symbol';

/**
 * Compute the latest TD Countdown state for one symbol. Needs at least 5 bars
 * (for the setup's close-vs-close[4 ago]); returns null on too little history.
 */
export function computeTdCountdown(bars: TdBar[]): TdCountdownStats | null {
  const n = bars.length;
  if (n < 5) return null;

  let downStreak = 0;
  let upStreak = 0;
  let dir: TdCountdownDir = 'none';
  let count = 0;
  let cd8close = NaN; // close of countdown bar 8
  let completed = false;
  let deferred = false;

  for (let i = 0; i < n; i++) {
    const prevDown = downStreak;
    const prevUp = upStreak;

    if (i >= 4) {
      const c = bars[i].close;
      const c4 = bars[i - 4].close;
      if (c < c4) {
        downStreak = Math.min(downStreak + 1, 9);
        upStreak = 0;
      } else if (c > c4) {
        upStreak = Math.min(upStreak + 1, 9);
        downStreak = 0;
      } else {
        downStreak = 0;
        upStreak = 0;
      }
    }

    // Arm / cancel on a fresh setup completion (streak transitions 8 → 9).
    const buySetupDone = downStreak === 9 && prevDown === 8;
    const sellSetupDone = upStreak === 9 && prevUp === 8;
    if (buySetupDone && dir !== 'buy') {
      dir = 'buy';
      count = 0;
      cd8close = NaN;
      completed = false;
      deferred = false;
    } else if (sellSetupDone && dir !== 'sell') {
      dir = 'sell';
      count = 0;
      cd8close = NaN;
      completed = false;
      deferred = false;
    }

    // Advance the active countdown on the current bar.
    if (!completed && i >= 2) {
      if (dir === 'buy' && bars[i].close <= bars[i - 2].low) {
        if (count < 12) {
          count += 1;
          deferred = false;
          if (count === 8) cd8close = bars[i].close;
        } else {
          // count === 12: bar-13 qualifier.
          if (!Number.isNaN(cd8close) && bars[i].low <= cd8close) {
            count = 13;
            completed = true;
            deferred = false;
          } else {
            deferred = true;
          }
        }
      } else if (dir === 'sell' && bars[i].close >= bars[i - 2].high) {
        if (count < 12) {
          count += 1;
          deferred = false;
          if (count === 8) cd8close = bars[i].close;
        } else {
          if (!Number.isNaN(cd8close) && bars[i].high >= cd8close) {
            count = 13;
            completed = true;
            deferred = false;
          } else {
            deferred = true;
          }
        }
      }
    }
  }

  return { direction: count > 0 ? dir : 'none', count, completed, deferred, n };
}

/** Build a sorted per-symbol TD Countdown board, skipping symbols with too little history. */
export function tdCountdownBoard(
  series: { symbol: string; bars: TdBar[] }[],
  sort: TdCountdownSort = 'count',
): TdCountdownRow[] {
  const rows: TdCountdownRow[] = [];
  for (const s of series) {
    const stats = computeTdCountdown(s.bars);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTdCountdown(rows, sort);
}

export function sortTdCountdown(rows: TdCountdownRow[], sort: TdCountdownSort): TdCountdownRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'count':
    default:
      // Highest count first; among equal counts, completed ones lead.
      out.sort((a, b) => b.count - a.count || Number(b.completed) - Number(a.completed));
      break;
  }
  return out;
}
