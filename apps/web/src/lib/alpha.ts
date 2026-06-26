/**
 * Jensen's alpha — the return a name delivers *beyond* what its market exposure
 * alone would predict. CAPM says an asset should earn rf + β·(market − rf); alpha
 * is the actual return minus that prediction:
 *
 *     alpha = annualized return − beta · annualized benchmark return     (rf = 0)
 *
 * It is the OLS intercept of the asset's returns regressed on the benchmark's
 * (here BTC), annualized. A positive alpha is genuine outperformance — return
 * that beta-to-BTC can't account for; a negative alpha means the name lagged
 * what its BTC sensitivity already entitled it to. Where the Treynor board ranks
 * *return per unit of beta*, alpha ranks *return in excess of beta's prediction*
 * — the two together (plus the beta board) complete the CAPM picture.
 *
 * Risk-free is taken as zero (consistent with the rest of the ratio suite). Beta
 * reuses the shared cov/var computation; the board mirrors the beta / Treynor /
 * information-ratio boards (align every series to the common recent overlap, omit
 * the benchmark). Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { computeBeta } from './beta';

export interface AlphaStat {
  /** Annualized Jensen's alpha (fraction): annReturn − beta·benchReturn. */
  alpha: number;
  /** Beta of the asset vs the benchmark. */
  beta: number;
  /** Annualized asset return (arithmetic mean × periods/yr), as a fraction. */
  annReturn: number;
  /** Annualized benchmark return (same across rows; shown for context). */
  benchReturn: number;
}

export interface AlphaRow extends AlphaStat {
  symbol: string;
  /** Returns used. */
  n: number;
}

export type AlphaSort = 'alpha' | 'beta' | 'annReturn' | 'symbol';

export interface AlphaInput {
  symbol: string;
  closes: number[];
}

/**
 * Jensen's alpha for one asset's returns vs the benchmark's. Returns null when
 * beta is undefined (constant benchmark or fewer than two overlapping points).
 * Alpha itself is always defined once beta is.
 */
export function computeAlpha(
  assetReturns: number[],
  benchReturns: number[],
  periodsPerYear: number,
): AlphaStat | null {
  const stat = computeBeta(assetReturns, benchReturns);
  if (!stat) return null;
  const n = Math.min(assetReturns.length, benchReturns.length);
  const annReturn = mean(assetReturns.slice(0, n)) * periodsPerYear;
  const benchReturn = mean(benchReturns.slice(0, n)) * periodsPerYear;
  const beta = stat.beta;
  const alpha = annReturn - beta * benchReturn;
  return { alpha, beta, annReturn, benchReturn };
}

/**
 * Build a Jensen's-alpha board: each name's annualized alpha vs the benchmark,
 * computed on returns over the common (most-recent) overlap. The benchmark itself
 * is omitted. Returns [] if the benchmark series is missing.
 */
export function alphaBoard(
  series: AlphaInput[],
  benchmark: string,
  periodsPerYear: number,
  sort: AlphaSort = 'alpha',
): AlphaRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: AlphaRow[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    const ret = toReturns(s.closes.slice(-k));
    const stat = computeAlpha(ret, benchRet, periodsPerYear);
    if (!stat) continue;
    rows.push({ symbol: s.symbol, ...stat, n: ret.length });
  }
  return sortAlpha(rows, sort);
}

export function sortAlpha(rows: AlphaRow[], sort: AlphaSort): AlphaRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'beta':
        return b.beta - a.beta;
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'alpha':
      default:
        return b.alpha - a.alpha; // most outperformance first
    }
  });
  return out;
}
