/**
 * Risk budgeting — decompose a portfolio's total volatility into the share each
 * holding actually contributes, which is rarely the same as its dollar weight. A
 * name can be 20% of the book but drive 40% of the swings (high vol, or
 * correlated with everything else); the optimizers (OPT/MSR) choose weights,
 * this panel audits where the risk in your *current* weights really sits.
 *
 * The decomposition is the standard Euler one. With weights w and return
 * covariance Σ, the portfolio volatility is σ_p = √(wᵀΣw); the marginal
 * contribution to risk of asset i is
 *
 *     MCTR_i = (Σw)_i / σ_p,
 *
 * and its component (total) contribution is RC_i = w_i · MCTR_i. By Euler's
 * theorem (σ_p is homogeneous of degree 1 in w) these sum exactly to σ_p, so
 * each name's percent of risk RC_i / σ_p sums to 100%.
 *
 * Reuses the covariance matrix built for the optimizers. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { stdev } from './distribution';
import { covarianceMatrix } from './minVariance';

export interface RiskBudgetInput {
  symbol: string;
  /** Portfolio weight (fraction of total value; may be negative for a short). */
  weight: number;
  closes: number[];
}

export interface RiskDecomp {
  /** Daily portfolio volatility, √(wᵀΣw). */
  portVol: number;
  /** Marginal contribution to risk per asset, (Σw)_i / σ_p. */
  mctr: number[];
  /** Component (total) contribution per asset, w_i · MCTR_i; sums to portVol. */
  riskContrib: number[];
  /** Percent of total risk per asset; sums to 100. */
  pctRisk: number[];
}

export interface RiskBudgetRow {
  symbol: string;
  /** Input weight (fraction of total value). */
  weight: number;
  /** Own daily return volatility. */
  vol: number;
  /** Marginal contribution to risk. */
  mctr: number;
  /** Component contribution to risk (sums to portVol across rows). */
  riskContrib: number;
  /** Percent of total portfolio risk; sums to 100. */
  pctRisk: number;
  /** Percent of total weight (w_i / Σw); sums to 100 when weights share a sign. */
  pctWeight: number;
}

export interface RiskBudgetResult {
  rows: RiskBudgetRow[];
  n: number;
  obs: number;
  portVol: number;
  ok: boolean;
}

const EMPTY: RiskBudgetResult = { rows: [], n: 0, obs: 0, portVol: 0, ok: false };

/**
 * Euler risk decomposition of weights `w` under covariance `cov`. Returns null
 * when the portfolio volatility is zero (degenerate — no risk to attribute).
 */
export function riskDecomposition(cov: number[][], w: number[]): RiskDecomp | null {
  const n = cov.length;
  if (n === 0 || w.length !== n) return null;
  // Σw and the quadratic form wᵀΣw.
  const sigmaW = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += cov[i][j] * w[j];
    sigmaW[i] = s;
  }
  let portVar = 0;
  for (let i = 0; i < n; i++) portVar += w[i] * sigmaW[i];
  if (portVar <= 0) return null;
  const portVol = Math.sqrt(portVar);

  const mctr = sigmaW.map((s) => s / portVol);
  const riskContrib = w.map((wi, i) => wi * mctr[i]);
  const pctRisk = riskContrib.map((rc) => (rc / portVol) * 100);
  return { portVol, mctr, riskContrib, pctRisk };
}

/**
 * Risk budget across a portfolio's holdings. Symbols are aligned to a common
 * tail window, turned into daily returns, and any flat/too-short series is
 * dropped (with its weight). Rows are sorted by percent-of-risk descending. When
 * the book carries no risk (all weights zero, or a single flat name) the result
 * is flagged `ok: false`.
 */
export function riskBudget(inputs: RiskBudgetInput[]): RiskBudgetResult {
  const long = inputs.filter((s) => s.closes.length >= 3);
  if (long.length === 0) return EMPTY;

  const L = Math.min(...long.map((s) => s.closes.length));

  const kept: { symbol: string; weight: number; rets: number[]; vol: number }[] = [];
  for (const s of long) {
    const tail = s.closes.slice(s.closes.length - L);
    const rets = toReturns(tail);
    const vol = stdev(rets);
    if (vol > 0) kept.push({ symbol: s.symbol, weight: s.weight, rets, vol });
  }
  const n = kept.length;
  if (n === 0) return EMPTY;

  const obs = kept[0].rets.length;
  const cov = covarianceMatrix(kept.map((k) => k.rets));
  const w = kept.map((k) => k.weight);

  const decomp = riskDecomposition(cov, w);
  if (!decomp) return { rows: [], n, obs, portVol: 0, ok: false };

  let wSum = 0;
  for (const wi of w) wSum += wi;

  const rows: RiskBudgetRow[] = kept.map((k, i) => ({
    symbol: k.symbol,
    weight: k.weight,
    vol: k.vol,
    mctr: decomp.mctr[i],
    riskContrib: decomp.riskContrib[i],
    pctRisk: decomp.pctRisk[i],
    pctWeight: wSum !== 0 ? (k.weight / wSum) * 100 : 0,
  }));
  rows.sort((a, b) => b.pctRisk - a.pctRisk);

  return { rows, n, obs, portVol: decomp.portVol, ok: true };
}
