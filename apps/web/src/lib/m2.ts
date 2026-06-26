/**
 * M² (Modigliani–Modigliani) risk-adjusted performance — the Sharpe ratio
 * restated in *return units*, on a level playing field with the benchmark:
 *
 *     M² = annualized return × (σ_benchmark / σ_asset) = Sharpe × σ_benchmark
 *
 * It answers a question a bare Sharpe number can't: "what would this name have
 * returned if it had been levered or de-levered to the *market's* risk?" A name
 * twice as volatile as BTC gets de-levered to half its return; a placid name at
 * half BTC's vol gets levered up to double. Every result is then directly
 * comparable to BTC's own return — and to every other name — because they all
 * sit at the same (BTC) volatility. M² ranks identically to the Sharpe ratio
 * (the benchmark vol is a positive constant across the board); its value is the
 * point, giving an intuitive, return-denominated read of risk-adjusted skill.
 *
 * Risk-free is taken as zero (consistent with the rest of the suite), so the
 * numerator is the asset's own annualized return. Reuses the shared mean & stdev;
 * the board mirrors the beta / alpha / Treynor boards (align every series to the
 * common recent overlap, omit the benchmark). Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean, stdev } from './distribution';

/** Below this per-period asset vol there is effectively no risk to adjust for → null. */
const MIN_SIGMA = 1e-9;

export interface M2Stat {
  /** Annualized M² (return units): annReturn × σ_bench/σ_asset. */
  m2: number;
  /** Annualized Sharpe ratio of the asset. */
  sharpe: number;
  /** Annualized asset return (fraction). */
  annReturn: number;
  /** Annualized asset volatility (fraction). */
  volAsset: number;
}

export interface M2Row extends M2Stat {
  symbol: string;
  /** Returns used. */
  n: number;
}

export type M2Sort = 'm2' | 'sharpe' | 'annReturn' | 'volAsset' | 'symbol';

export interface M2Input {
  symbol: string;
  closes: number[];
}

/**
 * M² stats for one asset's returns vs the benchmark's. Returns null when the
 * asset has ~no variance — a flat or near-flat series, where Sharpe / M² are
 * undefined (and a tiny floating-point residual vol would otherwise explode the
 * ratio) — or fewer than two overlapping points. A constant benchmark just
 * yields M² = 0 (everyone rescaled to zero risk), degenerate but not a crash.
 */
export function computeM2(
  assetReturns: number[],
  benchReturns: number[],
  periodsPerYear: number,
): M2Stat | null {
  const n = Math.min(assetReturns.length, benchReturns.length);
  if (n < 2) return null;
  const a = assetReturns.slice(0, n);
  const b = benchReturns.slice(0, n);
  const sigmaA = stdev(a);
  if (sigmaA < MIN_SIGMA) return null; // asset has ~no variance — risk-adjustment undefined
  const sigmaB = stdev(b);
  const sqrtPpy = Math.sqrt(periodsPerYear);
  const annReturn = mean(a) * periodsPerYear;
  const sharpe = (mean(a) / sigmaA) * sqrtPpy;
  const volAsset = sigmaA * sqrtPpy;
  const m2 = annReturn * (sigmaB / sigmaA); // ≡ sharpe × (σ_bench·√ppy)
  return { m2, sharpe, annReturn, volAsset };
}

/**
 * Build an M² board: each name's return rescaled to the benchmark's volatility,
 * on returns over the common (most-recent) overlap. The benchmark itself is
 * omitted. Returns [] if the benchmark series is missing.
 */
export function m2Board(
  series: M2Input[],
  benchmark: string,
  periodsPerYear: number,
  sort: M2Sort = 'm2',
): M2Row[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: M2Row[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    const ret = toReturns(s.closes.slice(-k));
    const stat = computeM2(ret, benchRet, periodsPerYear);
    if (!stat) continue;
    rows.push({ symbol: s.symbol, ...stat, n: ret.length });
  }
  return sortM2(rows, sort);
}

export function sortM2(rows: M2Row[], sort: M2Sort): M2Row[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'sharpe':
        return b.sharpe - a.sharpe;
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'volAsset':
        return b.volAsset - a.volAsset; // most volatile first
      case 'm2':
      default:
        return b.m2 - a.m2; // best risk-adjusted (BTC-vol-equivalent return) first
    }
  });
  return out;
}
