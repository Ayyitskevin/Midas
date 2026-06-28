/**
 * Gopalakrishnan Range Index (GAPO / GRI) screener helpers.
 *
 * Jayanthi Gopalakrishnan's range index is a log-scaled measure of how wide a
 * symbol's recent trading range is, over a lookback of `period` bars:
 *
 *   HH    = highest high over the last N bars
 *   LL    = lowest low  over the last N bars
 *   GAPO  = ln(HH − LL) / ln(N)
 *
 * It is a range-expansion gauge (not a bounded 0–100 classifier like the
 * Choppiness Index): a rising GAPO means the absolute high-low range is
 * widening (volatility up, breakouts), a falling GAPO means it is contracting
 * (consolidation). The log base is irrelevant — change-of-base cancels between
 * numerator and denominator — so ln and log10 give the same value; we use the
 * natural log, the canonical convention, and add no scaling constant.
 *
 * Cross-symbol caveat (handled here): the raw range HH−LL is in price units, so
 * GAPO ≈ [ln(price level) + ln(relative range)] / ln(N) — the price-level term
 * dominates, and a watchlist sorted on raw GAPO would rank by how expensive each
 * coin is, not by volatility. So while the canonical GAPO is reported faithfully,
 * the board screens on two scale-invariant companions:
 *
 *   rangePct = 100 · (HH − LL) / close   — the same "how much range" signal GAPO
 *              encodes, but comparable across price scales (the default sort)
 *   slope    = GAPO_latest − GAPO_prev    — range expansion vs contraction; the
 *              price-level term differences out, so it too is scale-robust
 *
 * Reuses the shared RangeBar typing. Pure and synchronous for exact unit tests.
 */
import { type RangeBar } from './range';

export type GapoBar = RangeBar;
export type GapoDir = 'up' | 'down' | 'flat';

export interface GapoStats {
  /** Canonical Gopalakrishnan Range Index: ln(HH − LL) / ln(N). Unbounded. */
  gapo: number;
  /** Window range as a % of the latest close — scale-invariant range size. */
  rangePct: number;
  /** GAPO change vs the prior bar's window (range expanding > 0 / contracting < 0). */
  slope: number;
  /** Sign of the slope: range expanding (up), contracting (down), or flat. */
  dir: GapoDir;
  /** Lookback period used. */
  period: number;
  /** Number of bars supplied. */
  n: number;
}

export interface GapoRow extends GapoStats {
  symbol: string;
}

export type GapoSort = 'range' | 'gapo' | 'slope' | 'symbol';

/** GAPO over the N-bar window ending at index `end` (inclusive). Null on a flat window. */
function windowGapo(
  bars: GapoBar[],
  end: number,
  period: number,
): { gapo: number; range: number } | null {
  let hh = -Infinity;
  let ll = Infinity;
  for (let i = end - period + 1; i <= end; i++) {
    if (bars[i].high > hh) hh = bars[i].high;
    if (bars[i].low < ll) ll = bars[i].low;
  }
  const range = hh - ll;
  if (!(range > 0)) return null;
  return { gapo: Math.log(range) / Math.log(period), range };
}

/**
 * Compute the latest GAPO for one symbol. Needs at least `period + 1` bars (the
 * extra bar lets us also measure the prior window for the expansion slope);
 * returns null on bad params, too little history, or a degenerate flat window.
 */
export function computeGapo(bars: GapoBar[], period = 5): GapoStats | null {
  if (period < 2) return null;
  const n = bars.length;
  if (n < period + 1) return null;

  const cur = windowGapo(bars, n - 1, period);
  const prev = windowGapo(bars, n - 2, period);
  if (!cur || !prev) return null;

  const close = bars[n - 1].close;
  if (!(close > 0)) return null;

  const rangePct = (100 * cur.range) / close;
  const slope = cur.gapo - prev.gapo;
  const dir: GapoDir = slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat';
  return { gapo: cur.gapo, rangePct, slope, dir, period, n };
}

/** Build a sorted per-symbol GAPO board, skipping symbols with too little history. */
export function gapoBoard(
  series: { symbol: string; bars: GapoBar[] }[],
  sort: GapoSort = 'range',
  period = 5,
): GapoRow[] {
  const rows: GapoRow[] = [];
  for (const s of series) {
    const stats = computeGapo(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortGapo(rows, sort);
}

export function sortGapo(rows: GapoRow[], sort: GapoSort): GapoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'gapo':
      // Raw canonical GAPO (price-scale dependent — mostly ranks by price level).
      out.sort((a, b) => b.gapo - a.gapo);
      break;
    case 'slope':
      // Strongest range expansion first, deepest contraction last.
      out.sort((a, b) => b.slope - a.slope);
      break;
    case 'range':
    default:
      // Widest range relative to price first — the scale-invariant default.
      out.sort((a, b) => b.rangePct - a.rangePct);
      break;
  }
  return out;
}
