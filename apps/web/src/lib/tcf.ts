/**
 * Trend Continuation Factor (TCF) screener helpers.
 *
 * M.H. Pee's Trend Continuation Factor (Technical Analysis of Stocks &
 * Commodities, V20:3, March 2002). It measures how *cleanly* a trend persists
 * by accumulating each directional run and penalising it with the opposite
 * run's accumulation. For each bar:
 *
 *   change = close − close_prev
 *   plus   = max(change, 0)              minus = max(−change, 0)
 *   CFp    = plus  == 0 ? 0 : plus  + CFp_prev   // cumulative up-run, resets on any non-up bar
 *   CFm    = minus == 0 ? 0 : minus + CFm_prev   // cumulative down-run, resets on any non-down bar
 *   TCFp   = plus  − CFm                 TCFm  = minus − CFp
 *   +TCF   = Σ TCFp over the last N bars  −TCF = Σ TCFm over the last N bars
 *
 * +TCF > 0 marks a strong uptrend, −TCF > 0 a strong downtrend (the two cannot
 * both be positive); when both are ≤ 0 the market is consolidating. Used much
 * like ADX — a trend-strength / direction filter (Pee's default length is 35).
 *
 * Pee computes the factors on the raw price change (points). For a cross-symbol
 * crypto screener that is not comparable (a $60k coin's moves dwarf a $2 alt's),
 * so this implementation feeds the same recursion *percent* returns
 * (100·(close − close_prev) / close_prev) — a structure-preserving,
 * scale-invariant adaptation. The reset/accumulation logic and the long/short
 * interpretation are unchanged; only the units become percent.
 *
 * Construction (the reset rule, the cross-subtracted Σ(plus − CFm) form, the
 * 35-bar window and the interpretation) was confirmed against Pee's published
 * definition and three independent ports, with a numeric fixture verified to
 * machine precision. Pure and synchronous so it can be unit-tested directly.
 * Distinct from the Trend *Trigger* Factor (`ttf.ts`), a different Pee indicator.
 */

export type TcfRegime = 'up' | 'down' | 'range';

export interface TcfStats {
  /** +TCF: summed positive trend-continuation factor over the window (percent units). */
  trendPlus: number;
  /** −TCF: summed negative trend-continuation factor over the window (percent units). */
  trendMinus: number;
  /** Regime from the two factors: up (+TCF>0), down (−TCF>0), else range. */
  regime: TcfRegime;
  /** Number of closes supplied. */
  n: number;
}

export interface TcfRow extends TcfStats {
  symbol: string;
}

export type TcfSort = 'plus' | 'minus' | 'symbol';

/**
 * Compute the latest Trend Continuation Factor for one symbol from a close
 * series. Feeds the recursion percent returns for scale-invariance. Needs at
 * least `length + 1` closes (one full N-bar window of factors); returns null
 * otherwise.
 */
export function computeTcf(closes: number[], length = 35): TcfStats | null {
  const n = closes.length;
  if (length < 1 || n < length + 1) return null;

  const tcfp: number[] = [];
  const tcfm: number[] = [];
  let cfp = 0;
  let cfm = 0;
  for (let i = 1; i < n; i++) {
    const prev = closes[i - 1];
    const ret = prev === 0 ? 0 : (100 * (closes[i] - prev)) / prev;
    const plus = ret > 0 ? ret : 0;
    const minus = ret < 0 ? -ret : 0;
    cfp = plus === 0 ? 0 : plus + cfp;
    cfm = minus === 0 ? 0 : minus + cfm;
    tcfp.push(plus - cfm);
    tcfm.push(minus - cfp);
  }

  let trendPlus = 0;
  let trendMinus = 0;
  for (let k = tcfp.length - length; k < tcfp.length; k++) {
    trendPlus += tcfp[k];
    trendMinus += tcfm[k];
  }

  const regime: TcfRegime = trendPlus > 0 ? 'up' : trendMinus > 0 ? 'down' : 'range';
  return { trendPlus, trendMinus, regime, n };
}

/** Build a sorted per-symbol Trend Continuation Factor board, skipping thin history. */
export function tcfBoard(
  series: { symbol: string; closes: number[] }[],
  sort: TcfSort = 'plus',
  length = 35,
): TcfRow[] {
  const rows: TcfRow[] = [];
  for (const s of series) {
    const stats = computeTcf(s.closes, length);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTcf(rows, sort);
}

export function sortTcf(rows: TcfRow[], sort: TcfSort): TcfRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'minus':
      // Strongest downtrends (most positive −TCF) first.
      out.sort((a, b) => b.trendMinus - a.trendMinus);
      break;
    case 'plus':
    default:
      // Strongest uptrends (most positive +TCF) first, downtrends at the bottom.
      out.sort((a, b) => b.trendPlus - a.trendPlus);
      break;
  }
  return out;
}
