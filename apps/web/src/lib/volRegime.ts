/**
 * Rolling-volatility regime — is each name's volatility expanding or contracting
 * right now, and where does today's vol sit in its own recent history? For each
 * symbol it compares a short trailing window of realized volatility to a longer
 * one:
 *
 *     ratio = shortVol / longVol
 *
 * A ratio above 1 means the recent stretch is choppier than the longer baseline
 * (vol expanding — risk waking up); below 1 means it is calming. The percentile
 * places today's short-window vol within the full distribution of rolling
 * short-window vols, so a high reading flags a genuinely elevated regime rather
 * than a small relative wiggle.
 *
 * Reuses the shared simple returns and population stdev. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { stdev } from './distribution';

export interface VRegRow {
  symbol: string;
  /** Realized vol over the short trailing window (daily stdev). */
  shortVol: number;
  /** Realized vol over the long trailing window (daily stdev). */
  longVol: number;
  /** shortVol / longVol; null when the long-window vol is zero. */
  ratio: number | null;
  /** Percentile of today's short vol within the rolling short-vol history (0–100). */
  pct: number | null;
  /** Returns used. */
  n: number;
}

export type VRegSort = 'ratio' | 'pct' | 'shortVol' | 'symbol';

export interface VRegInput {
  symbol: string;
  closes: number[];
}

/**
 * Volatility-regime stats for one close series. `shortW`/`longW` are window
 * lengths in returns (longW must exceed shortW ≥ 2). Returns null when the
 * windows are invalid or there isn't a full long window of returns.
 */
export function computeVolRegime(
  closes: number[],
  shortW: number,
  longW: number,
): Omit<VRegRow, 'symbol'> | null {
  if (shortW < 2 || longW <= shortW) return null;
  const returns = toReturns(closes);
  const n = returns.length;
  if (n < longW) return null;

  const shortVol = stdev(returns.slice(n - shortW));
  const longVol = stdev(returns.slice(n - longW));
  const ratio = longVol > 0 ? shortVol / longVol : null;

  // Rolling short-window vols across the whole return history; today's is the
  // last. Percentile = share of that history at or below today's reading.
  let le = 0;
  let total = 0;
  for (let i = shortW; i <= n; i++) {
    const v = stdev(returns.slice(i - shortW, i));
    if (v <= shortVol) le += 1;
    total += 1;
  }
  const pct = total > 0 ? (le / total) * 100 : null;

  return { shortVol, longVol, ratio, pct, n };
}

/**
 * Volatility-regime board across a basket at shared window lengths, sorted
 * (default by the expansion ratio descending — choppiest-relative first).
 */
export function volRegimeBoard(
  series: VRegInput[],
  shortW: number,
  longW: number,
  sort: VRegSort = 'ratio',
): VRegRow[] {
  const rows: VRegRow[] = [];
  for (const s of series) {
    const r = computeVolRegime(s.closes, shortW, longW);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortVReg(rows, sort);
}

export function sortVReg(rows: VRegRow[], sort: VRegSort): VRegRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'pct':
        return lo(b.pct) - lo(a.pct);
      case 'shortVol':
        return b.shortVol - a.shortVol;
      case 'ratio':
      default:
        return lo(b.ratio) - lo(a.ratio);
    }
  });
  return out;
}
