/**
 * Chart granularity — candle intervals and lookback ranges, plus their guards.
 * Part of the @midas/shared data contract (re-exported from index.ts).
 */

/** Candle granularity, mirroring the intervals Yahoo Finance accepts. */
export type Interval =
  | '1m'
  | '2m'
  | '5m'
  | '15m'
  | '30m'
  | '60m'
  | '90m'
  | '1d'
  | '1wk'
  | '1mo';

/** Lookback window for a history request. */
export type Range =
  | '1d'
  | '5d'
  | '1mo'
  | '3mo'
  | '6mo'
  | '1y'
  | '2y'
  | '5y'
  | 'max';

export const INTERVALS: readonly Interval[] = [
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '60m',
  '90m',
  '1d',
  '1wk',
  '1mo',
];

export const RANGES: readonly Range[] = [
  '1d',
  '5d',
  '1mo',
  '3mo',
  '6mo',
  '1y',
  '2y',
  '5y',
  'max',
];

export function isInterval(value: string): value is Interval {
  return (INTERVALS as readonly string[]).includes(value);
}

export function isRange(value: string): value is Range {
  return (RANGES as readonly string[]).includes(value);
}
