import type { Candle } from '@midas/shared';

/**
 * Daily returns laid out as a calendar — the GitHub-contribution grid, but each
 * cell is a day's percent return instead of a commit count. Days are placed in
 * week-columns (a new column each Sunday) and weekday-rows (0 = Sunday … 6 =
 * Saturday), all in UTC so the grid is stable regardless of the viewer's zone.
 *
 * Returns are simple close-to-close: r_t = close_t / close_{t-1} − 1, attributed
 * to day t. Alongside the grid we surface the obvious read-outs — best and worst
 * day, the share of up days, the average daily return, and the current run of
 * consecutive up (or down) days.
 */

export interface DayReturn {
  /** Day timestamp in epoch ms (UTC midnight). */
  time: number;
  /** ISO date (YYYY-MM-DD, UTC). */
  date: string;
  /** Weekday, 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Column index — weeks since the first day's week. */
  week: number;
  /** Close-to-close return as a fraction. */
  ret: number;
}

export interface ReturnsCalendar {
  /** One entry per day with a return, in ascending date order. */
  days: DayReturn[];
  /** Number of week-columns spanned. */
  weeks: number;
  /** Largest absolute daily return (for color scaling). */
  maxAbsReturn: number;
  /** Best up day, or null when empty. */
  best: DayReturn | null;
  /** Worst down day, or null when empty. */
  worst: DayReturn | null;
  /** Fraction of days that were positive. */
  positiveRate: number;
  /** Mean daily return. */
  avgReturn: number;
  /** Current run: +n consecutive up days, −n down days, 0 if flat/empty. */
  streak: number;
  /** Number of days with a return. */
  count: number;
}

/** Normalize a candle timestamp (seconds or ms) to epoch ms. */
const toMs = (t: number): number => (t < 1e12 ? t * 1000 : t);
const DAY_MS = 86_400_000;

/**
 * Build a daily returns calendar from OHLCV candles (expected daily). Returns
 * null when there isn't at least one return to place (fewer than two candles).
 */
export function returnsCalendar(candles: Candle[]): ReturnsCalendar | null {
  if (!candles || candles.length < 2) return null;

  const days: DayReturn[] = [];
  let firstWeekStartIndex = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const close = candles[i].close;
    if (!(prev > 0) || !Number.isFinite(close)) continue;
    const ms = toMs(candles[i].time);
    const dayIndex = Math.floor(ms / DAY_MS);
    const d = new Date(dayIndex * DAY_MS);
    const weekday = d.getUTCDay();
    if (days.length === 0) firstWeekStartIndex = dayIndex - weekday;
    days.push({
      time: dayIndex * DAY_MS,
      date: d.toISOString().slice(0, 10),
      weekday,
      week: Math.floor((dayIndex - firstWeekStartIndex) / 7),
      ret: close / prev - 1,
    });
  }

  if (days.length === 0) return null;

  let maxAbsReturn = 0;
  let best = days[0];
  let worst = days[0];
  let positives = 0;
  let sum = 0;
  for (const d of days) {
    maxAbsReturn = Math.max(maxAbsReturn, Math.abs(d.ret));
    if (d.ret > best.ret) best = d;
    if (d.ret < worst.ret) worst = d;
    if (d.ret > 0) positives += 1;
    sum += d.ret;
  }

  // Current streak: walk back from the most recent day while the sign holds.
  const lastSign = Math.sign(days[days.length - 1].ret);
  let streak = 0;
  if (lastSign !== 0) {
    for (let i = days.length - 1; i >= 0; i--) {
      if (Math.sign(days[i].ret) === lastSign) streak += 1;
      else break;
    }
    streak *= lastSign;
  }

  const weeks = days[days.length - 1].week + 1;

  return {
    days,
    weeks,
    maxAbsReturn,
    best,
    worst,
    positiveRate: positives / days.length,
    avgReturn: sum / days.length,
    streak,
    count: days.length,
  };
}
