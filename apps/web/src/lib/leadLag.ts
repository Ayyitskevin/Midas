/**
 * Lead-lag vs the market — does an alt move BEFORE BTC or AFTER it? We slide each
 * name's return series against BTC's across a range of lags and find the lag at
 * which they co-move most strongly (the peak of the cross-correlation function):
 *
 *     xcorr(L) = corr( asset[t], bench[t − L] )
 *       L > 0 ⇒ asset best matches PAST BTC  → BTC leads, the name LAGS by L
 *       L < 0 ⇒ asset best matches FUTURE BTC → the name LEADS BTC by |L|
 *       L = 0 ⇒ synchronous
 *
 * A name that consistently leads BTC is an early-warning tell; one that lags is a
 * follower you can trade off BTC's move. We report the peak lag, its correlation,
 * and the plain contemporaneous (lag-0) correlation for context.
 *
 * To avoid the trap that a 2-point correlation is always ±1, a lag is only
 * considered when at least MIN_PAIRS observations overlap — so extreme lags on a
 * short history can't manufacture a spurious peak. Reuses the shared Pearson and
 * simple returns; the board aligns to the common recent overlap and omits the
 * benchmark. Pure for unit testing.
 */

import { toReturns, pearson } from './correlation';

/** A lag needs at least this many overlapping points to be trusted. */
const MIN_PAIRS = 3;

export interface LeadLagStat {
  /** Lag of peak correlation. >0 = BTC leads (name lags); <0 = name leads BTC; 0 = synchronous. */
  peakLag: number;
  /** Correlation at the peak lag. */
  peakCorr: number;
  /** Contemporaneous (lag-0) correlation, for context. */
  corr0: number;
}

export interface LeadLagRow extends LeadLagStat {
  symbol: string;
  /** Returns used. */
  n: number;
}

export type LeadLagSort = 'peakLag' | 'peakCorr' | 'corr0' | 'symbol';

export interface LeadLagInput {
  symbol: string;
  closes: number[];
}

/**
 * Cross-correlation of asset vs bench at integer `lag`, pairing asset[t] with
 * bench[t − lag]. Returns null when fewer than MIN_PAIRS points overlap.
 */
export function crossCorr(asset: number[], bench: number[], lag: number): number | null {
  const n = Math.min(asset.length, bench.length);
  const a: number[] = [];
  const b: number[] = [];
  for (let t = 0; t < n; t++) {
    const s = t - lag;
    if (s >= 0 && s < n) {
      a.push(asset[t]);
      b.push(bench[s]);
    }
  }
  if (a.length < MIN_PAIRS) return null;
  return pearson(a, b);
}

/**
 * Peak-correlation lag of asset returns vs bench returns, scanning lags in
 * [−maxLag, maxLag]. Returns null when there is no usable overlap (too little
 * history for even the lag-0 correlation). On ties the lag closest to zero wins,
 * so a genuinely synchronous name is not nudged off 0 by a coincidental tie.
 */
export function computeLeadLag(
  assetReturns: number[],
  benchReturns: number[],
  maxLag: number,
): LeadLagStat | null {
  const c0 = crossCorr(assetReturns, benchReturns, 0);
  if (c0 == null) return null;
  let peakLag = 0;
  let peakCorr = c0;
  for (let L = -maxLag; L <= maxLag; L++) {
    if (L === 0) continue;
    const c = crossCorr(assetReturns, benchReturns, L);
    if (c == null) continue;
    if (c > peakCorr || (c === peakCorr && Math.abs(L) < Math.abs(peakLag))) {
      peakCorr = c;
      peakLag = L;
    }
  }
  return { peakLag, peakCorr, corr0: c0 };
}

/**
 * Build a lead-lag board: each non-benchmark name's peak-correlation lag vs the
 * benchmark over the common recent overlap. The benchmark is omitted; returns []
 * if the benchmark series is missing.
 */
export function leadLagBoard(
  series: LeadLagInput[],
  benchmark: string,
  maxLag: number,
  sort: LeadLagSort = 'peakLag',
): LeadLagRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: LeadLagRow[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    const ret = toReturns(s.closes.slice(-k));
    const stat = computeLeadLag(ret, benchRet, maxLag);
    if (!stat) continue;
    rows.push({ symbol: s.symbol, ...stat, n: ret.length });
  }
  return sortLeadLag(rows, sort);
}

export function sortLeadLag(rows: LeadLagRow[], sort: LeadLagSort): LeadLagRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'peakCorr':
        return b.peakCorr - a.peakCorr;
      case 'corr0':
        return b.corr0 - a.corr0;
      case 'peakLag':
      default:
        return a.peakLag - b.peakLag; // most-leading (most negative lag) first
    }
  });
  return out;
}
