/**
 * Monthly returns calendar: month-over-month returns derived from a candle
 * series, laid out as a year × month grid with compounded year totals. Times
 * are grouped in UTC; candle timestamps may be seconds or millis. Pure for
 * unit testing.
 */

import type { Candle } from '@midas/shared';

const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);

export interface MonthEnd {
  year: number;
  month: number; // 0–11
  close: number;
}

/** Last close of each calendar month, in chronological order. */
export function monthEndCloses(candles: Candle[]): MonthEnd[] {
  const sorted = [...candles].filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
  const map = new Map<string, MonthEnd>();
  const order: string[] = [];
  for (const c of sorted) {
    const d = new Date(toMs(c.time));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${month}`;
    if (!map.has(key)) order.push(key);
    map.set(key, { year, month, close: c.close }); // last write in the month wins
  }
  return order.map((k) => map.get(k)!);
}

export interface MonthReturn {
  year: number;
  month: number;
  ret: number;
}

/** Month-over-month returns (the return realized during each month). */
export function monthlyReturns(candles: Candle[]): MonthReturn[] {
  const ends = monthEndCloses(candles);
  const out: MonthReturn[] = [];
  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1].close;
    if (prev > 0) out.push({ year: ends[i].year, month: ends[i].month, ret: ends[i].close / prev - 1 });
  }
  return out;
}

export interface YearRow {
  year: number;
  months: (number | null)[]; // length 12, null when no data
  total: number | null; // compounded over the year's available months
}

export interface MonthlyGrid {
  years: YearRow[]; // most recent first
  best: number | null;
  worst: number | null;
}

export function monthlyGrid(candles: Candle[]): MonthlyGrid {
  const rets = monthlyReturns(candles);
  const byYear = new Map<number, (number | null)[]>();
  let best: number | null = null;
  let worst: number | null = null;
  for (const r of rets) {
    if (!byYear.has(r.year)) byYear.set(r.year, Array(12).fill(null));
    byYear.get(r.year)![r.month] = r.ret;
    if (best == null || r.ret > best) best = r.ret;
    if (worst == null || r.ret < worst) worst = r.ret;
  }
  const years: YearRow[] = [...byYear.keys()]
    .sort((a, b) => b - a)
    .map((year) => {
      const months = byYear.get(year)!;
      let acc = 1;
      let any = false;
      for (const m of months) {
        if (m != null) {
          acc *= 1 + m;
          any = true;
        }
      }
      return { year, months, total: any ? acc - 1 : null };
    });
  return { years, best, worst };
}
