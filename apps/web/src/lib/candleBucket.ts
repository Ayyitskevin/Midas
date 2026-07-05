/** Interval → seconds, and timestamp bucketing for live candle rolling. */

/** Seconds per chart interval — used to bucket live trade prints into candles. */
export const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60,
  '2m': 120,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '60m': 3600,
  '90m': 5400,
  '1d': 86_400,
  '1wk': 604_800,
  '1mo': 2_592_000,
};

/** Floor a ms timestamp to the start of its interval bucket (in seconds). */
export function candleBucketStart(tsMs: number, stepSec: number): number {
  return Math.floor(tsMs / 1000 / stepSec) * stepSec;
}
