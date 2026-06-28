/**
 * Arnaud Legoux Moving Average (ALMA) screener helpers.
 *
 * ALMA (Arnaud Legoux & Dimitris Kouzis-Loukas) is a Gaussian-weighted FIR over
 * the trailing N bars whose weight peak is slid toward the recent end of the
 * window, giving a low-lag yet smooth line:
 *
 *   m = offset · (N − 1)              // Gaussian peak position within the window
 *   s = N / sigma                     // Gaussian width (index units)
 *   w[i] = exp( −(i − m)² / (2·s²) )   // i = 0 (oldest) … N−1 (current bar)
 *   ALMA = Σ w[i]·price[i] / Σ w[i]
 *
 * Defaults N = 9, offset = 0.85, sigma = 6. offset near 1 pushes the weight peak
 * toward the current bar (responsive); offset near 0 toward older bars (smooth).
 *
 * CONVENTION (confirmed by a multi-agent derive→fixture→verify workflow, high
 * confidence): the peak `m` is NOT floored by default — this matches TradingView's
 * `ta.alma(..., floor = false)` reference. A `floor` option integerises the peak
 * (the common community-port variant) when a caller must mirror it. Window
 * indexing runs oldest→newest, so the highest weight index is the current bar;
 * reversing it (peak on the oldest bar) is the classic porting bug.
 *
 * ALMA is a price-unit line (a convex combination of prices), so the raw value is
 * not comparable across symbols. The board reports the scale-invariant slope of
 * the line (slopePct) and the price's percent distance from it (distPct) — the
 * same convention as the Hull / McGinley / VIDYA boards.
 *
 * Machine-precision fixture: closes [10,11,13,12,14,16,15,17,19,18,20,22], N=9,
 * offset=0.85, sigma=6 → ALMA = 19.537194543716783 (prior bar 18.364132147807595).
 *
 * Pure and synchronous.
 */

/**
 * ALMA aligned to the input series: indices < window−1 are NaN (insufficient
 * history). The Gaussian weight vector is constant for a given (window, offset,
 * sigma, floor), so it is built once and reused across bars.
 */
export function almaSeries(
  values: number[],
  window = 9,
  offset = 0.85,
  sigma = 6,
  floor = false,
): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (window < 1 || sigma <= 0 || n < window) return out;

  const mRaw = offset * (window - 1);
  const m = floor ? Math.floor(mRaw) : mRaw;
  const s = window / sigma;
  const denom = 2 * s * s;

  const w = new Array<number>(window);
  let norm = 0;
  for (let i = 0; i < window; i++) {
    const wi = Math.exp(-((i - m) * (i - m)) / denom);
    w[i] = wi;
    norm += wi;
  }

  for (let e = window - 1; e < n; e++) {
    let sum = 0;
    const start = e - window + 1;
    for (let i = 0; i < window; i++) sum += w[i] * values[start + i];
    out[e] = sum / norm;
  }
  return out;
}

export type AlmaDir = 'up' | 'down' | 'flat';

export interface AlmaStats {
  /** Latest ALMA line value (price units — not for cross-symbol ranking). */
  alma: number;
  /** Slope of the line: 100·(alma − almaPrev) / almaPrev (scale-invariant). */
  slopePct: number;
  /** Price distance from the line: 100·(close − alma) / alma (scale-invariant). */
  distPct: number;
  /** Trend direction from the slope sign. */
  dir: AlmaDir;
  /** Number of bars supplied. */
  n: number;
}

export interface AlmaRow extends AlmaStats {
  symbol: string;
}

export type AlmaSort = 'slope' | 'dist' | 'symbol';

/**
 * Compute the latest ALMA reading for one symbol. Needs at least window+1 closes
 * (so the line and its prior bar both exist); returns null on bad params or too
 * little history.
 */
export function computeAlma(
  closes: number[],
  window = 9,
  offset = 0.85,
  sigma = 6,
  floor = false,
): AlmaStats | null {
  const n = closes.length;
  if (window < 1 || sigma <= 0 || n < window + 1) return null;

  const series = almaSeries(closes, window, offset, sigma, floor);
  const alma = series[n - 1];
  const almaPrev = series[n - 2];
  if (!Number.isFinite(alma) || !Number.isFinite(almaPrev) || alma === 0 || almaPrev === 0) return null;

  const close = closes[n - 1];
  const slopePct = (100 * (alma - almaPrev)) / almaPrev;
  const distPct = (100 * (close - alma)) / alma;
  const dir: AlmaDir = slopePct > 0 ? 'up' : slopePct < 0 ? 'down' : 'flat';

  return { alma, slopePct, distPct, dir, n };
}

/** Build a sorted per-symbol ALMA board, skipping symbols with too little history. */
export function almaBoard(
  series: { symbol: string; closes: number[] }[],
  sort: AlmaSort = 'slope',
  window = 9,
  offset = 0.85,
  sigma = 6,
  floor = false,
): AlmaRow[] {
  const rows: AlmaRow[] = [];
  for (const s of series) {
    const stats = computeAlma(s.closes, window, offset, sigma, floor);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortAlma(rows, sort);
}

export function sortAlma(rows: AlmaRow[], sort: AlmaSort): AlmaRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'dist':
      out.sort((a, b) => b.distPct - a.distPct);
      break;
    case 'slope':
    default:
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
  }
  return out;
}
