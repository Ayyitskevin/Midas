/**
 * Summary stats over a perp's funding-rate history: the current and average
 * rate (and their annualized APR via the shared annualizer), the range, and how
 * often funding was positive. Pure for unit testing.
 */

import type { FundingHistoryPoint } from '@midas/shared';
import { annualizedFundingPct } from './funding';

export interface FundingSummary {
  count: number;
  current: number | null; // most recent rate (fraction)
  average: number | null;
  currentApr: number | null; // annualized %
  averageApr: number | null;
  min: number | null;
  max: number | null;
  /** Fraction of settlements with a positive rate (longs paid). */
  positiveShare: number;
}

export function summarizeFunding(points: FundingHistoryPoint[], intervalHours = 8): FundingSummary {
  const rates = points
    .map((p) => p.fundingRate)
    .filter((r): r is number => r != null && Number.isFinite(r));
  if (rates.length === 0) {
    return {
      count: 0,
      current: null,
      average: null,
      currentApr: null,
      averageApr: null,
      min: null,
      max: null,
      positiveShare: 0,
    };
  }
  const current = rates[rates.length - 1];
  let sum = 0;
  let min = rates[0];
  let max = rates[0];
  let pos = 0;
  for (const r of rates) {
    sum += r;
    if (r < min) min = r;
    if (r > max) max = r;
    if (r > 0) pos += 1;
  }
  const average = sum / rates.length;
  return {
    count: rates.length,
    current,
    average,
    currentApr: annualizedFundingPct(current, intervalHours),
    averageApr: annualizedFundingPct(average, intervalHours),
    min,
    max,
    positiveShare: pos / rates.length,
  };
}
