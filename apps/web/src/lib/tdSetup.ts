/**
 * TD Sequential — TD Setup (TDS) screener helpers.
 *
 * Tom DeMark's TD Setup is the first phase of TD Sequential — a price-exhaustion
 * counter (not an oscillator or average). It counts consecutive closes relative
 * to the close four bars earlier:
 *
 *   TD Buy Setup  — 9 consecutive bars with close < close[4 bars ago]
 *                   (a falling market stretched toward a potential bottom).
 *   TD Sell Setup — 9 consecutive bars with close > close[4 bars ago]
 *                   (a rising market stretched toward a potential top).
 *
 * The count runs 1 → 9; a single close that breaks the relationship resets it.
 * Each direction's run begins (count 1) only after the opposite/neutral bar that
 * reset it — DeMark's "TD Price Flip" — so the simple reset-on-break counter
 * captures the flip automatically. Once a run reaches 9 the setup is complete; the
 * count is clamped at 9 (it does not extend) until a flip resets it.
 *
 * Perfection — a stronger completion. A buy setup is "perfected" when the low of
 * bar 8 or bar 9 is ≤ the lows of bars 6 and 7; a sell setup when the high of bar
 * 8 or bar 9 is ≥ the highs of bars 6 and 7 (the tail of the setup makes a fresh
 * extreme). Evaluated when the setup is complete, using the most recent four bars
 * (bar 9 = current bar).
 *
 * Buy/sell counts compare closes, so the count itself is scale-free; perfection
 * compares each symbol's own highs/lows, so the board ranks cleanly across
 * symbols. Pure and synchronous.
 */

/** Minimal bar (TD Setup needs close for the count, high/low for perfection). */
export interface TdBar {
  high: number;
  low: number;
  close: number;
}

export type TdDirection = 'buy' | 'sell' | 'none';

export interface TdSetupStats {
  /** buy = potential bottom (down-closes), sell = potential top (up-closes). */
  direction: TdDirection;
  /** Active setup count 1–9 (clamped); 0 when no setup is active. */
  count: number;
  /** The count has reached 9 (setup complete). */
  completed: boolean;
  /** Completion geometry satisfied (only meaningful when completed). */
  perfected: boolean;
  /** Number of bars supplied. */
  n: number;
}

export interface TdSetupRow extends TdSetupStats {
  symbol: string;
}

export type TdSetupSort = 'count' | 'symbol';

/**
 * Compute the latest TD Setup state for one symbol. Needs at least 5 bars (so a
 * close-vs-close[4 ago] comparison exists); returns null on too little history.
 */
export function computeTdSetup(bars: TdBar[]): TdSetupStats | null {
  const n = bars.length;
  if (n < 5) return null;

  let downStreak = 0; // → TD Buy Setup
  let upStreak = 0; //   → TD Sell Setup
  for (let i = 4; i < n; i++) {
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

  const direction: TdDirection = downStreak > 0 ? 'buy' : upStreak > 0 ? 'sell' : 'none';
  const count = direction === 'buy' ? downStreak : direction === 'sell' ? upStreak : 0;
  const completed = count >= 9;

  let perfected = false;
  if (completed && n >= 4) {
    const last = n - 1; // bar 9
    const b8 = bars[last - 1];
    const b9 = bars[last];
    const b7 = bars[last - 2];
    const b6 = bars[last - 3];
    if (direction === 'buy') {
      perfected =
        (b8.low <= b6.low && b8.low <= b7.low) || (b9.low <= b6.low && b9.low <= b7.low);
    } else {
      perfected =
        (b8.high >= b6.high && b8.high >= b7.high) || (b9.high >= b6.high && b9.high >= b7.high);
    }
  }

  return { direction, count, completed, perfected, n };
}

/** Build a sorted per-symbol TD Setup board, skipping symbols with too little history. */
export function tdSetupBoard(
  series: { symbol: string; bars: TdBar[] }[],
  sort: TdSetupSort = 'count',
): TdSetupRow[] {
  const rows: TdSetupRow[] = [];
  for (const s of series) {
    const stats = computeTdSetup(s.bars);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTdSetup(rows, sort);
}

export function sortTdSetup(rows: TdSetupRow[], sort: TdSetupSort): TdSetupRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'count':
    default:
      // Highest count first; among equal counts, perfected ones lead.
      out.sort((a, b) => b.count - a.count || Number(b.perfected) - Number(a.perfected));
      break;
  }
  return out;
}
