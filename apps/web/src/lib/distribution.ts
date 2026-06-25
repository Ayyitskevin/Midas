/**
 * Return-distribution statistics: moments (mean / std / skew / excess
 * kurtosis), quantiles, historical Value-at-Risk and Expected Shortfall, and a
 * histogram. VaR/ES are expressed as positive loss fractions at a confidence
 * level (e.g. 0.95). Pure for unit testing.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation. */
export function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / n);
}

/** Sample skewness (population moments); 0 if degenerate. */
export function skewness(xs: number[]): number {
  const n = xs.length;
  const sd = stdev(xs);
  if (n < 2 || sd === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 3;
  return s / n;
}

/** Excess kurtosis (population moments); 0 if degenerate. */
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  const sd = stdev(xs);
  if (n < 2 || sd === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 4;
  return s / n - 3;
}

/** Linear-interpolation quantile of an UNSORTED series, p in [0,1]. */
export function quantile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  if (n === 1) return s[0];
  const idx = Math.min(n - 1, Math.max(0, p * (n - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (idx - lo) * (s[hi] - s[lo]);
}

export interface VarResult {
  /** Value-at-Risk as a positive loss fraction at the confidence level. */
  var: number;
  /** Expected shortfall (mean loss beyond VaR), positive fraction. */
  es: number;
}

/**
 * Historical VaR / ES at `conf` (e.g. 0.95). The (1−conf) left-tail quantile is
 * the VaR threshold; ES averages the returns at or below it. Returns positive
 * loss magnitudes (0 when the tail isn't a loss).
 */
export function historicalVar(returns: number[], conf: number): VarResult {
  if (returns.length === 0) return { var: 0, es: 0 };
  const p = Math.min(1, Math.max(0, 1 - conf));
  const threshold = quantile(returns, p);
  const tail = returns.filter((r) => r <= threshold);
  const tailMean = tail.length > 0 ? mean(tail) : threshold;
  return { var: Math.max(0, -threshold), es: Math.max(0, -tailMean) };
}

export interface Bin {
  start: number;
  end: number;
  count: number;
}

/** Bin a series into `bins` equal-width buckets spanning its min…max. */
export function histogram(xs: number[], bins: number): Bin[] {
  if (xs.length === 0 || bins < 1) return [];
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  const width = (hi - lo) / bins;
  const out: Bin[] = Array.from({ length: bins }, (_, i) => ({
    start: lo + i * width,
    end: lo + (i + 1) * width,
    count: 0,
  }));
  for (const x of xs) {
    let k = Math.floor((x - lo) / width);
    if (k < 0) k = 0;
    if (k >= bins) k = bins - 1; // include the max in the last bin
    out[k].count += 1;
  }
  return out;
}

export interface ReturnStats {
  n: number;
  mean: number;
  vol: number; // per-period std
  skew: number;
  kurtosis: number;
  min: number;
  max: number;
  var: number;
  es: number;
}

export function returnStats(returns: number[], conf: number): ReturnStats {
  const { var: v, es } = historicalVar(returns, conf);
  return {
    n: returns.length,
    mean: mean(returns),
    vol: stdev(returns),
    skew: skewness(returns),
    kurtosis: kurtosis(returns),
    min: returns.length ? Math.min(...returns) : 0,
    max: returns.length ? Math.max(...returns) : 0,
    var: v,
    es,
  };
}
