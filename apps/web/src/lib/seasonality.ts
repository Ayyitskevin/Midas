/**
 * Returns seasonality — pure and offline. Buckets hourly returns by UTC
 * day-of-week and hour-of-day to reveal recurring timing patterns. Each return
 * is attributed to the bucket of the candle that closed it (its UTC weekday and
 * hour). Averages are simple percentage returns.
 */

export interface SeasonCandle {
  time: number;
  close: number;
}

export interface Bucket {
  avg: number | null;
  n: number;
}

export interface Seasonality {
  /** grid[day 0=Sun..6=Sat][hour 0..23]. */
  grid: Bucket[][];
  /** Marginal average per hour-of-day (0..23). */
  byHour: Bucket[];
  /** Marginal average per day-of-week (0=Sun..6=Sat). */
  byDay: Bucket[];
  totalSamples: number;
  /** Largest |avg| across populated grid cells, for colour scaling. */
  maxAbsAvg: number;
}

interface Acc {
  sum: number;
  n: number;
}

const finalize = (a: Acc): Bucket => ({ avg: a.n > 0 ? a.sum / a.n : null, n: a.n });

export function computeSeasonality(candles: readonly SeasonCandle[]): Seasonality {
  const grid: Acc[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ sum: 0, n: 0 })),
  );
  const byHour: Acc[] = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
  const byDay: Acc[] = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  let totalSamples = 0;

  for (let i = 1; i < candles.length; i++) {
    const c0 = candles[i - 1].close;
    const c1 = candles[i].close;
    if (!(c0 > 0) || !(c1 > 0)) continue;
    const r = (c1 / c0 - 1) * 100;

    // Candle `time` is a Unix timestamp in SECONDS (the @midas/shared contract);
    // new Date() wants ms, so scale up. The threshold also tolerates a value
    // that already arrived in ms.
    const t = candles[i].time;
    const d = new Date(t < 1e12 ? t * 1000 : t);
    const day = d.getUTCDay();
    const hour = d.getUTCHours();

    grid[day][hour].sum += r;
    grid[day][hour].n += 1;
    byHour[hour].sum += r;
    byHour[hour].n += 1;
    byDay[day].sum += r;
    byDay[day].n += 1;
    totalSamples += 1;
  }

  let maxAbsAvg = 0;
  const outGrid = grid.map((row) =>
    row.map((cell) => {
      const b = finalize(cell);
      if (b.avg != null && Math.abs(b.avg) > maxAbsAvg) maxAbsAvg = Math.abs(b.avg);
      return b;
    }),
  );

  return {
    grid: outGrid,
    byHour: byHour.map(finalize),
    byDay: byDay.map(finalize),
    totalSamples,
    maxAbsAvg,
  };
}
