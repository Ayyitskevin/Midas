/**
 * Summary stats over a perp's funding-rate history: the current and average
 * rate (and their annualized APR via the shared annualizer), the range, and how
 * often funding was positive. Pure for unit testing.
 */

import {
  deriveDataReceipt,
  type DataProvenance,
  type DataReceipt,
  type FundingHistoryPoint,
} from '@midas/shared';
import { annualizedFundingPct } from './funding';

export interface FundingSummary {
  count: number;
  current: number | null; // most recent rate (fraction)
  average: number | null;
  currentApr: number | null; // annualized %
  averageApr: number | null;
  /** Common, explicit settlement cadence used for APR; null when unknown/mixed. */
  intervalHours: number | null;
  min: number | null;
  max: number | null;
  /** Fraction of settlements with a positive rate (longs paid). */
  positiveShare: number;
}

export function summarizeFunding(
  points: FundingHistoryPoint[],
  explicitIntervalHours?: number | null,
): FundingSummary {
  const rated = points.filter(
    (point): point is FundingHistoryPoint & { fundingRate: number } =>
      point.fundingRate != null && Number.isFinite(point.fundingRate),
  );
  const rates = rated.map((point) => point.fundingRate);
  const intervals = rated.map((point) => point.fundingIntervalHours);
  const reportedInterval =
    intervals.length > 0 &&
    intervals.every(
      (value) =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0 &&
        value === intervals[0],
    )
      ? (intervals[0] as number)
      : null;
  const intervalHours =
    explicitIntervalHours !== undefined
      ? typeof explicitIntervalHours === 'number' &&
        Number.isFinite(explicitIntervalHours) &&
        explicitIntervalHours > 0
        ? explicitIntervalHours
        : null
      : reportedInterval;
  if (rates.length === 0) {
    return {
      count: 0,
      current: null,
      average: null,
      currentApr: null,
      averageApr: null,
      intervalHours,
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
    intervalHours,
    min,
    max,
    positiveShare: pos / rates.length,
  };
}

export interface InspectedFundingSummary {
  summary: FundingSummary;
  receipt: DataReceipt | null;
}

/** Build the funding-history aggregate and its complete input lineage. */
export function inspectFundingSummary(
  points: FundingHistoryPoint[],
  instrument: string,
  evaluatedAtMs: number = Date.now(),
): InspectedFundingSummary {
  const summary = summarizeFunding(points);
  const used = points.filter(
    (point): point is FundingHistoryPoint & { fundingRate: number } =>
      point.fundingRate != null && Number.isFinite(point.fundingRate),
  );
  const inputReceipts = used.flatMap((point) => (point.receipt ? [point.receipt] : []));
  if (used.length === 0 || inputReceipts.length !== used.length) return { summary, receipt: null };
  const provenance: DataProvenance = inputReceipts.some((receipt) => receipt.provenance === 'unavailable')
    ? 'unavailable'
    : inputReceipts.some((receipt) => receipt.provenance === 'synthetic')
      ? 'synthetic'
      : 'live';
  try {
    const receipt = deriveDataReceipt(
      {
        providerId: 'midas-web',
        providerVersion: '1.0',
        source: 'Midas client funding-history reducer',
        venue: inputReceipts.every((candidate) => candidate.venue === inputReceipts[0]?.venue)
          ? inputReceipts[0]?.venue ?? null
          : null,
        datasetFamily: 'funding-history',
        instrument,
        coverage: `${used.length} funding settlement(s)`,
        provenance,
        expectedCadenceMs:
          summary.intervalHours == null ? null : summary.intervalHours * 3_600_000,
        units: {
          average: 'fraction per settlement',
          fundingRate: 'fraction per settlement',
          intervalHours: 'hours',
        },
        methodology: {
          id: 'funding-history-summary',
          version: '1.0',
          formula:
            'current=last; average=sum(rate)/count; min/max over settlements; APR only when every input declares one common cadence',
        },
        inputReceipts,
        limitations:
          summary.intervalHours == null
            ? ['Funding settlement cadence is unknown or mixed; APR is unavailable.']
            : [],
        note: provenance === 'live' ? null : `Derived from ${provenance} funding-history evidence.`,
      },
      evaluatedAtMs,
    );
    return { summary, receipt };
  } catch {
    return { summary, receipt: null };
  }
}
