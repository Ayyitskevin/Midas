import type { LiquidationEvent, LiquidationsMeta, LiquidationsProvenance } from '@midas/shared';

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

/**
 * User-facing honesty label for a liquidations feed meta.
 *
 * Contract: synthetic or mock-sourced feeds are never labeled live — even when
 * `available` is true (demo events exist, but they are not real liquidations).
 */
export type LiquidationsFeedLabel = 'live' | 'demo' | 'no-feed';

export function liquidationsFeedLabel(
  meta: Pick<LiquidationsProvenance, 'available' | 'synthetic' | 'source'>,
): LiquidationsFeedLabel {
  if (meta.synthetic) return 'demo';
  // Defense in depth: a mock provider that forgot `synthetic: true` still
  // must not paint a green "live" badge.
  const src = meta.source.toLowerCase();
  if (src === 'mock' || src.startsWith('mock')) return 'demo';
  if (!meta.available) return 'no-feed';
  return 'live';
}

/** True only when the feed may be labeled live (never synthetic/mock). */
export function liquidationsFeedIsLive(
  meta: Pick<LiquidationsProvenance, 'available' | 'synthetic' | 'source'>,
): boolean {
  return liquidationsFeedLabel(meta) === 'live';
}

export function liquidationsFeedBadge(
  meta: Pick<LiquidationsMeta, 'available' | 'synthetic' | 'source' | 'note'>,
): { label: LiquidationsFeedLabel; title: string; liveTone: boolean } {
  const label = liquidationsFeedLabel(meta);
  if (label === 'demo') {
    return {
      label,
      title: meta.note?.trim() || 'Synthetic demo data — not a live feed',
      liveTone: false,
    };
  }
  if (label === 'no-feed') {
    return {
      label,
      title: meta.note?.trim() || 'Source has no public liquidation feed',
      liveTone: false,
    };
  }
  return {
    label,
    title: meta.note?.trim() || 'Source publishes liquidations',
    liveTone: true,
  };
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
