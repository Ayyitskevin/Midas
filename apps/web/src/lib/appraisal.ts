/**
 * Appraisal ratio (Treynor–Black) — risk-adjusted alpha:
 *
 *     appraisal = Jensen's alpha / idiosyncratic (residual) volatility
 *
 * Jensen's alpha (the ALPHA board) tells you how much a name out- or under-
 * performs its CAPM prediction, but not how much *bet* you took to get it. The
 * appraisal ratio divides that alpha by the standard deviation of the regression
 * residuals — the name-specific, diversifiable risk left after stripping out its
 * BTC exposure. So it answers: per unit of idiosyncratic risk you carried, how
 * much stock-specific outperformance did you actually earn? It is the natural
 * "how good is this active bet" companion to Jensen's alpha, and the building
 * block of the Treynor–Black optimal-portfolio weighting.
 *
 * Residuals are εₜ = (assetₜ − mean) − β·(benchₜ − mean) — the part of each
 * period's return the market can't explain. Both alpha and the residual vol are
 * annualized (alpha ∝ ppy, vol ∝ √ppy), so the ratio annualizes like a Sharpe:
 * the per-period ratio × √ppy. Reuses the shared Jensen's-alpha computation; the
 * board mirrors the alpha / Treynor / beta boards. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { computeAlpha } from './alpha';

/** Below this annualized residual vol there is no real idiosyncratic risk → null. */
const MIN_RESIDUAL_VOL = 1e-9;

export interface AppraisalStat {
  /** annualized alpha ÷ annualized residual vol; null when residual vol is 0. */
  appraisal: number | null;
  /** Annualized Jensen's alpha (fraction). */
  alpha: number;
  /** Annualized idiosyncratic (residual) volatility (fraction). */
  residualVol: number;
  /** Beta of the asset vs the benchmark. */
  beta: number;
}

export interface AppraisalRow extends AppraisalStat {
  symbol: string;
  /** Returns used. */
  n: number;
}

export type AppraisalSort = 'appraisal' | 'alpha' | 'residualVol' | 'symbol';

export interface AppraisalInput {
  symbol: string;
  closes: number[];
}

/**
 * Appraisal stats for one asset's returns vs the benchmark's. Returns null when
 * beta is undefined (constant benchmark / fewer than two overlapping points). The
 * appraisal itself is null when the residual volatility is ~zero — the asset is a
 * (near-)perfect linear function of the benchmark, so there is no idiosyncratic
 * risk to divide by.
 */
export function computeAppraisal(
  assetReturns: number[],
  benchReturns: number[],
  periodsPerYear: number,
): AppraisalStat | null {
  const a = computeAlpha(assetReturns, benchReturns, periodsPerYear);
  if (!a) return null;
  const n = Math.min(assetReturns.length, benchReturns.length);
  const asset = assetReturns.slice(0, n);
  const bench = benchReturns.slice(0, n);
  const ma = mean(asset);
  const mb = mean(bench);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const resid = asset[i] - ma - a.beta * (bench[i] - mb); // OLS residual (zero mean)
    sumSq += resid * resid;
  }
  const residualVol = Math.sqrt(sumSq / n) * Math.sqrt(periodsPerYear);
  const appraisal = residualVol > MIN_RESIDUAL_VOL ? a.alpha / residualVol : null;
  return { appraisal, alpha: a.alpha, residualVol, beta: a.beta };
}

/**
 * Build an appraisal-ratio board: each name's annualized alpha ÷ its residual
 * vol vs the benchmark, on returns over the common (most-recent) overlap. The
 * benchmark itself is omitted. Returns [] if the benchmark series is missing.
 */
export function appraisalBoard(
  series: AppraisalInput[],
  benchmark: string,
  periodsPerYear: number,
  sort: AppraisalSort = 'appraisal',
): AppraisalRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: AppraisalRow[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    const ret = toReturns(s.closes.slice(-k));
    const stat = computeAppraisal(ret, benchRet, periodsPerYear);
    if (!stat) continue;
    rows.push({ symbol: s.symbol, ...stat, n: ret.length });
  }
  return sortAppraisal(rows, sort);
}

export function sortAppraisal(rows: AppraisalRow[], sort: AppraisalSort): AppraisalRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v); // null appraisal sinks last
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'alpha':
        return b.alpha - a.alpha;
      case 'residualVol':
        return b.residualVol - a.residualVol; // most idiosyncratic risk first
      case 'appraisal':
      default:
        return lo(b.appraisal) - lo(a.appraisal); // best risk-adjusted alpha first
    }
  });
  return out;
}
