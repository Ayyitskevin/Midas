import type { LiquidationEvent } from '@midas/shared';

export interface LiqSummary {
  /** Notional of liquidated longs (order side 'sell'). */
  longValue: number;
  /** Notional of liquidated shorts (order side 'buy'). */
  shortValue: number;
  total: number;
  count: number;
  longCount: number;
  shortCount: number;
}

/** Aggregate a liquidation feed into long/short notional + counts. */
export function summarizeLiquidations(events: LiquidationEvent[]): LiqSummary {
  let longValue = 0;
  let shortValue = 0;
  let longCount = 0;
  let shortCount = 0;
  for (const e of events) {
    if (e.side === 'sell') {
      longValue += e.value;
      longCount += 1;
    } else {
      shortValue += e.value;
      shortCount += 1;
    }
  }
  return {
    longValue,
    shortValue,
    total: longValue + shortValue,
    count: events.length,
    longCount,
    shortCount,
  };
}
