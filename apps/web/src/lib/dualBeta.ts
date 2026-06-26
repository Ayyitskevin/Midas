/**
 * Dual beta — each name's sensitivity to BOTH crypto majors at once, BTC and ETH,
 * so the divergence between the two is visible in a single row. Most "beta vs the
 * market" boards anchor on BTC alone, but the ETH / L2 / DeFi complex marches to a
 * different drum: a name with a high beta to ETH but a modest beta to BTC is
 * really an ETH-beta bet wearing a crypto-beta costume. We compute β-to-ETH and
 * β-to-BTC over the same window, plus their gap (ETH-leaning when positive) and
 * the correlation to ETH for context.
 *
 *     βx = cov(asset, x) / var(x)        for x ∈ {BTC, ETH}
 *     divergence = βETH − βBTC
 *
 * Both betas are measured on the common (most-recent) overlap across the names AND
 * both benchmarks, so they are directly comparable. Reuses the shared beta
 * (cov/var) computation and simple returns; the benchmarks are omitted from the
 * rows, and the board is empty if either BTC or ETH is missing. Pure for unit
 * testing.
 */

import { toReturns } from './correlation';
import { computeBeta } from './beta';

export interface DualBetaRow {
  symbol: string;
  /** Beta vs ETH. */
  betaEth: number;
  /** Beta vs BTC. */
  betaBtc: number;
  /** βETH − βBTC: positive = leans to ETH, negative = leans to BTC. */
  divergence: number;
  /** Correlation to ETH (context). */
  corrEth: number;
  /** Returns used. */
  n: number;
}

export type DualBetaSort = 'betaEth' | 'betaBtc' | 'divergence' | 'corrEth' | 'symbol';

export interface DualBetaInput {
  symbol: string;
  closes: number[];
}

/**
 * Build a dual-beta board: each non-benchmark name's beta to ETH and to BTC over
 * the common recent overlap, with their divergence. The two benchmarks are
 * omitted from the rows. Returns [] if either benchmark series is missing, and
 * skips any name whose beta is degenerate against either benchmark.
 */
export function dualBetaBoard(
  series: DualBetaInput[],
  btc: string,
  eth: string,
  sort: DualBetaSort = 'betaEth',
): DualBetaRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const btcS = valid.find((s) => s.symbol === btc);
  const ethS = valid.find((s) => s.symbol === eth);
  if (!btcS || !ethS) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const btcRet = toReturns(btcS.closes.slice(-k));
  const ethRet = toReturns(ethS.closes.slice(-k));

  const rows: DualBetaRow[] = [];
  for (const s of valid) {
    if (s.symbol === btc || s.symbol === eth) continue;
    const ret = toReturns(s.closes.slice(-k));
    const bBtc = computeBeta(ret, btcRet);
    const bEth = computeBeta(ret, ethRet);
    if (!bBtc || !bEth) continue;
    rows.push({
      symbol: s.symbol,
      betaEth: bEth.beta,
      betaBtc: bBtc.beta,
      divergence: bEth.beta - bBtc.beta,
      corrEth: bEth.correlation,
      n: ret.length,
    });
  }
  return sortDualBeta(rows, sort);
}

export function sortDualBeta(rows: DualBetaRow[], sort: DualBetaSort): DualBetaRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'betaBtc':
        return b.betaBtc - a.betaBtc;
      case 'divergence':
        return b.divergence - a.divergence; // most ETH-leaning first
      case 'corrEth':
        return b.corrEth - a.corrEth;
      case 'betaEth':
      default:
        return b.betaEth - a.betaEth;
    }
  });
  return out;
}
