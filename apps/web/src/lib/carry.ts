/**
 * Funding-carry / cash-and-carry math — pure and offline. Pairs each perp's
 * annualized funding (the carry you harvest delta-neutral) with its basis versus
 * spot (perp mark vs spot price), and names the leg that earns the funding.
 * Complements the raw funding board by framing funding as a trade.
 */

import { annualizedFundingPct } from './funding';

export interface CarrySource {
  symbol: string;
  fundingRate: number | null;
  markPrice: number | null;
  openInterestValue: number | null;
  nextFundingTime: number | null;
}

/** Which leg collects funding: short the perp when funding is positive. */
export type CarrySide = 'short-perp' | 'long-perp' | 'flat';

export interface CarryRow {
  symbol: string;
  fundingRate: number | null;
  /** Annualized funding (%). */
  aprPct: number | null;
  /** Perp mark vs spot, (mark/spot − 1) × 100. */
  basisPct: number | null;
  oi: number | null;
  nextFundingTime: number | null;
  side: CarrySide;
  mark: number | null;
  spot: number | null;
}

const EPS = 1e-9;

export function computeCarry(src: CarrySource, spot: number | null): CarryRow {
  const mark = src.markPrice != null && src.markPrice > 0 ? src.markPrice : null;
  const sp = spot != null && spot > 0 ? spot : null;
  const basisPct = mark != null && sp != null ? (mark / sp - 1) * 100 : null;

  const fr = src.fundingRate;
  const side: CarrySide = fr == null || Math.abs(fr) < EPS ? 'flat' : fr > 0 ? 'short-perp' : 'long-perp';

  return {
    symbol: src.symbol,
    fundingRate: fr,
    aprPct: annualizedFundingPct(fr),
    basisPct,
    oi: src.openInterestValue,
    nextFundingTime: src.nextFundingTime,
    side,
    mark,
    spot: sp,
  };
}

export type CarrySortKey = 'symbol' | 'apr' | 'basis' | 'oi';

export function sortCarry(rows: readonly CarryRow[], key: CarrySortKey, dir: 'asc' | 'desc'): CarryRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r: CarryRow): number | null =>
    key === 'apr' ? r.aprPct : key === 'basis' ? r.basisPct : key === 'oi' ? r.oi : null;
  return [...rows].sort((a, b) => {
    if (key === 'symbol') return a.symbol.localeCompare(b.symbol) * sign;
    return ((value(a) ?? -Infinity) - (value(b) ?? -Infinity)) * sign;
  });
}
