/**
 * Volatility cones — the distribution of realized volatility at several
 * measurement horizons, the classic "is vol rich or cheap?" picture. For each
 * horizon h we slide a window of h returns across the whole history, annualize
 * each window's realized vol, and take its percentiles (min / 25 / 50 / 75 /
 * max). Plotted across horizons the percentiles form a cone that narrows as the
 * horizon grows (longer-horizon vol estimates vary less), and overlaying the
 * latest window's vol shows where today sits inside each horizon's own history.
 *
 * Reuses the population stdev and interpolated quantile from ./distribution so
 * the numbers match the rest of the terminal's vol stats. Pure for unit testing.
 */

import { stdev, quantile } from './distribution';

export interface VolConePoint {
  /** Window length in returns (≈ days for daily candles). */
  horizon: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  max: number;
  /** The most recent window's annualized vol. */
  current: number;
  /** Percentile rank of `current` within this horizon's history, in [0, 1]. */
  rank: number;
  /** Number of overlapping windows sampled. */
  samples: number;
}

export interface VolCones {
  /** Cone points in ascending horizon order. */
  points: VolConePoint[];
  periodsPerYear: number;
}

/**
 * Build volatility cones from a return series across the given horizons.
 * Horizons below 2 or longer than the series are dropped; duplicates are merged
 * and the result is sorted ascending. Returns an empty `points` array when none
 * can be measured.
 */
export function volCones(
  returns: number[],
  horizons: number[],
  periodsPerYear = 365,
): VolCones {
  const ann = Math.sqrt(periodsPerYear);
  const hs = Array.from(new Set(horizons.filter((h) => Number.isFinite(h) && h >= 2 && Math.floor(h) === h))).sort(
    (a, b) => a - b,
  );

  const points: VolConePoint[] = [];
  for (const h of hs) {
    if (returns.length < h) continue;
    const vols: number[] = [];
    for (let i = 0; i + h <= returns.length; i++) {
      vols.push(stdev(returns.slice(i, i + h)) * ann);
    }
    if (vols.length === 0) continue;
    const current = vols[vols.length - 1];
    let atOrBelow = 0;
    for (const v of vols) if (v <= current) atOrBelow += 1;
    points.push({
      horizon: h,
      min: quantile(vols, 0),
      p25: quantile(vols, 0.25),
      p50: quantile(vols, 0.5),
      p75: quantile(vols, 0.75),
      max: quantile(vols, 1),
      current,
      rank: atOrBelow / vols.length,
      samples: vols.length,
    });
  }

  return { points, periodsPerYear };
}
