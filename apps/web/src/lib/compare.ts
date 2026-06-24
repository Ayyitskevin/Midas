import type { Candle } from '@midas/shared';
import type { LinePoint } from './indicators';

/**
 * Rebase a candle series to percent change from its first close — so multiple
 * symbols can be overlaid on one axis and compared regardless of nominal price.
 * Returns nothing if the series is empty or its base price is non-positive.
 */
export function rebasePercent(candles: Candle[]): LinePoint[] {
  if (candles.length === 0) return [];
  const base = candles[0].close;
  if (!(base > 0)) return [];
  return candles.map((c) => ({ time: c.time, value: (c.close / base - 1) * 100 }));
}

/** Total percent return across the series (0 if it has < 2 points or a bad base). */
export function totalReturnPct(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const base = candles[0].close;
  const last = candles[candles.length - 1].close;
  if (!(base > 0)) return 0;
  return (last / base - 1) * 100;
}
