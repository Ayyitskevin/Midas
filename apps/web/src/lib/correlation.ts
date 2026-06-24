/**
 * Pure helpers for the correlation matrix: simple returns, Pearson correlation,
 * the pairwise matrix, and a colour ramp. No React/DOM, so all are unit-tested.
 */

export interface CorrSeries {
  symbol: string;
  /** Close prices, already aligned to a common length across the basket. */
  closes: number[];
}

/** Period-over-period simple returns of a close series. */
export function toReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    out.push(prev === 0 ? 0 : (closes[i] - prev) / prev);
  }
  return out;
}

/** Pearson correlation of two equal-length series; 0 if either is constant. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  const r = cov / Math.sqrt(va * vb);
  // Guard against tiny floating-point overshoot past ±1.
  return Math.max(-1, Math.min(1, r));
}

/** Pairwise return-correlation matrix for a basket (rows/cols follow input order). */
export function correlationMatrix(series: CorrSeries[]): number[][] {
  const rets = series.map((s) => toReturns(s.closes));
  return series.map((_, i) =>
    series.map((__, j) => (i === j ? 1 : pearson(rets[i], rets[j]))),
  );
}

/** Green (positive) / red (negative) tile colour, opacity scaled by |r|. */
export function corrColor(r: number): string {
  const t = Math.max(-1, Math.min(1, Number.isFinite(r) ? r : 0));
  const alpha = (0.1 + 0.55 * Math.abs(t)).toFixed(3);
  return t >= 0 ? `rgba(38,194,129,${alpha})` : `rgba(239,77,86,${alpha})`;
}
