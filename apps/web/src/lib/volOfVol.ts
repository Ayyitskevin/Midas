/**
 * Volatility of volatility — is a name's *risk level itself* steady, or does it
 * lurch between calm and chaos? We take the rolling realized-volatility series
 * (the trailing annualized vol stepped through the sample) and measure how much
 * it moves around:
 *
 *     volOfVol = stdev(rolling vol)
 *     vov      = volOfVol / mean(rolling vol)   (coefficient of variation)
 *
 * The headline is the coefficient of variation, so names of very different
 * absolute vol compare fairly: an 80%-vol name that wobbles ±10% is *steadier*
 * (vov 0.13) than a 30%-vol name that wobbles ±15% (vov 0.5). High vov = an
 * unstable risk regime that whipsaws position sizing and breaks vol-targeting; low
 * vov = a name whose risk you can plan around. Because vov is a ratio of two vols,
 * it is unit-free and independent of the annualization factor.
 *
 * Reuses the shared simple returns plus mean & stdev. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean, stdev } from './distribution';

export interface VovRow {
  symbol: string;
  /** Coefficient of variation of the rolling vol: volOfVol ÷ meanVol; null when meanVol is 0. */
  vov: number | null;
  /** Mean of the rolling-volatility series (annualized fraction). */
  meanVol: number;
  /** Stdev of the rolling-volatility series (annualized fraction) — the absolute vol-of-vol. */
  volOfVol: number;
  /** Latest rolling vol (annualized), for context. */
  current: number;
  /** Number of rolling windows. */
  n: number;
}

export type VovSort = 'vov' | 'meanVol' | 'volOfVol' | 'symbol';

export interface VovInput {
  symbol: string;
  closes: number[];
}

/**
 * Rolling annualized volatility: the population stdev of returns over each
 * trailing `window`, stepped one period at a time. Empty when the window can't be
 * filled.
 */
export function rollingVol(closes: number[], window: number, periodsPerYear: number): number[] {
  const w = Math.floor(window);
  const returns = toReturns(closes);
  if (w < 2 || returns.length < w) return [];
  const k = Math.sqrt(periodsPerYear);
  const out: number[] = [];
  for (let i = w; i <= returns.length; i++) {
    out.push(stdev(returns.slice(i - w, i)) * k);
  }
  return out;
}

/**
 * Vol-of-vol stats for one close series. Returns null when fewer than two rolling
 * windows fit. The vov (coefficient of variation) is null when the mean rolling
 * vol is zero — a perfectly flat series with no volatility to vary.
 */
export function computeVov(
  closes: number[],
  window: number,
  periodsPerYear: number,
): Omit<VovRow, 'symbol'> | null {
  const series = rollingVol(closes, window, periodsPerYear);
  if (series.length < 2) return null; // need ≥ 2 windows for a stdev
  const meanVol = mean(series);
  const volOfVol = stdev(series);
  const vov = meanVol > 0 ? volOfVol / meanVol : null;
  return { vov, meanVol, volOfVol, current: series[series.length - 1], n: series.length };
}

/** Vol-of-vol board across a basket, sorted (default coefficient of variation descending). */
export function vovBoard(
  series: VovInput[],
  window: number,
  periodsPerYear: number,
  sort: VovSort = 'vov',
): VovRow[] {
  const rows: VovRow[] = [];
  for (const s of series) {
    const r = computeVov(s.closes, window, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortVov(rows, sort);
}

export function sortVov(rows: VovRow[], sort: VovSort): VovRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v); // null vov sinks last
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'meanVol':
        return b.meanVol - a.meanVol;
      case 'volOfVol':
        return b.volOfVol - a.volOfVol;
      case 'vov':
      default:
        return lo(b.vov) - lo(a.vov); // most-unstable-risk first
    }
  });
  return out;
}
