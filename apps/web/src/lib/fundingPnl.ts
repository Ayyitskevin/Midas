/**
 * Funding-carry P&L projection for a held perp position. Funding settles every
 * `intervalHours` (the venue's actual cadence — 1h on Hyperliquid-style venues,
 * 4/8h elsewhere): a long pays when the rate is positive and receives when
 * negative; a short is the mirror. At a constant rate the cumulative carry is
 * linear in the number of settlements. Pure for unit testing — it assumes the
 * current rate holds for the whole horizon. An unknown cadence is an invalid
 * projection, never a silent 8h assumption.
 */

export type PerpSide = 'long' | 'short';

export interface FundingInputs {
  side: PerpSide;
  /** Position notional in quote (USD). */
  notional: number;
  /** Funding rate per interval, as a fraction (0.0001 = 0.01%). */
  rate: number;
  /**
   * Venue-reported settlement cadence in hours; null/invalid when unknown —
   * the projection is then invalid rather than silently assuming 8h.
   */
  intervalHours: number | null;
  horizonDays: number;
}

export interface FundingProjection {
  valid: boolean;
  /** Signed payment per settlement (+ received / − paid), quote. */
  perInterval: number;
  intervalsPerDay: number;
  intervals: number; // settlements over the horizon
  daily: number; // signed
  horizonTotal: number; // signed cumulative over the horizon
  aprPct: number; // signed annualized carry, % of notional
  annualTotal: number; // signed carry over a year, quote
  receives: boolean;
  /** Cumulative carry after each settlement (index 1..intervals). */
  points: { i: number; cum: number }[];
}

const MAX_POINTS = 2000;

/**
 * The venue-reported settlement cadence when it is usable (finite, positive),
 * else null — callers must never fall back to an assumed 8h.
 */
export function validIntervalHours(hours: number | null | undefined): number | null {
  return hours != null && Number.isFinite(hours) && hours > 0 ? hours : null;
}

export function projectFunding({
  side,
  notional,
  rate,
  intervalHours,
  horizonDays,
}: FundingInputs): FundingProjection {
  const ih = validIntervalHours(intervalHours);
  const valid =
    ih != null &&
    Number.isFinite(notional) &&
    notional > 0 &&
    Number.isFinite(rate) &&
    Number.isFinite(horizonDays) &&
    horizonDays > 0;

  const sideSign = side === 'long' ? -1 : 1; // long pays positive funding
  const intervalsPerDay = ih != null ? 24 / ih : 0;
  const perInterval = valid ? sideSign * notional * rate : 0;
  const intervals = valid ? Math.floor(horizonDays * intervalsPerDay) : 0;
  const intervalsPerYear = intervalsPerDay * 365;

  const points: { i: number; cum: number }[] = [];
  const cap = Math.min(intervals, MAX_POINTS);
  for (let i = 1; i <= cap; i++) points.push({ i, cum: perInterval * i });

  return {
    valid,
    perInterval,
    intervalsPerDay,
    intervals,
    daily: perInterval * intervalsPerDay,
    horizonTotal: perInterval * intervals,
    aprPct: sideSign * rate * intervalsPerYear * 100,
    annualTotal: perInterval * intervalsPerYear,
    receives: perInterval >= 0,
    points,
  };
}
