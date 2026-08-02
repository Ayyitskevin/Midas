import {
  deriveDataReceipt,
  type DataReceipt,
  type LiquidationEvent,
  type LiquidationSourceStatus,
  type LiquidationsMeta,
  type LiquidationsProvenance,
} from '@midas/shared';

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

export interface InspectedLiquidationsSummary {
  summary: LiqSummary;
  receipt: DataReceipt | null;
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
  if (meta.source.trim().toLowerCase() === 'mock') return 'demo';
  if (!meta.available) return 'no-feed';
  return 'live';
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

/**
 * The state word shown next to one liquidation source.
 *
 * `quiet` and `skewed` exist because they are NOT `live`: a source that was read
 * but produced nothing, or whose newest event is ahead of our clock, has told us
 * nothing about its freshness. Collapsing either into `live` would be the
 * synthetic-as-live bug in a different costume.
 */
export type LiquidationSourceState =
  | 'live'
  | 'stale'
  | 'quiet'
  | 'skewed'
  | 'no feed'
  | 'not sampled'
  | 'demo';

export interface LiquidationSourceRow {
  source: string;
  state: LiquidationSourceState;
  /** `ok` paints green, `warn` amber, `dim` grey. Only a proven-fresh real source is `ok`. */
  tone: 'ok' | 'warn' | 'dim';
  detail: string;
}

export interface LiquidationSourcesView {
  rows: LiquidationSourceRow[];
  /** e.g. "1 of 6 venues sampled · 1 reporting". */
  coverageLabel: string;
  coverageTitle: string;
  /** True when the feed reads fewer venues than are configured. */
  partialCoverage: boolean;
}

function liquidationSourceRow(s: LiquidationSourceStatus): LiquidationSourceRow {
  const age = s.ageMs === null ? null : fmtDurationMs(s.ageMs);
  // Order matters: synthetic is checked first so a demo source can never fall
  // through to a live-toned branch.
  if (s.synthetic) {
    return { source: s.source, state: 'demo', tone: 'dim', detail: s.note ?? 'Fabricated events — not a live feed.' };
  }
  if (!s.available) {
    return { source: s.source, state: 'no feed', tone: 'dim', detail: s.note ?? 'No public liquidation feed.' };
  }
  if (!s.sampled) {
    return { source: s.source, state: 'not sampled', tone: 'dim', detail: s.note ?? 'Configured but not read by this feed.' };
  }
  if (s.stale === true) {
    return {
      source: s.source,
      state: 'stale',
      tone: 'warn',
      detail: `No event for ${age ?? 'an unknown time'} — the feed has gone quiet or dropped.`,
    };
  }
  if (s.stale === false) {
    return {
      source: s.source,
      state: 'live',
      tone: 'ok',
      detail: `${s.eventCount} event(s), newest ${age ?? 'unknown'} ago. Throttled stream — sizes are a lower bound.`,
    };
  }
  if (s.ageMs !== null && s.ageMs < 0) {
    return { source: s.source, state: 'skewed', tone: 'warn', detail: s.note ?? 'Newest event is ahead of this clock; freshness unknown.' };
  }
  return { source: s.source, state: 'quiet', tone: 'dim', detail: s.note ?? 'Read, but produced no events; freshness unknown.' };
}

function fmtDurationMs(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

/**
 * Render-ready per-source state and the coverage ratio.
 *
 * The ratio is surfaced rather than summarized away: a feed that reads 1 of 6
 * configured venues and reports one aggregate number is the exact false
 * confidence this panel exists to avoid.
 */
export function inspectLiquidationSources(
  meta: Pick<LiquidationsMeta, 'sources' | 'coverage'> | undefined,
): LiquidationSourcesView | null {
  if (!meta?.sources?.length || !meta.coverage) return null;
  const { configured, sampled, reporting, ratio } = meta.coverage;
  const pct = ratio === null ? null : `${Math.round(ratio * 100)}%`;
  return {
    rows: meta.sources.map(liquidationSourceRow),
    coverageLabel: `${sampled} of ${configured} venue${configured === 1 ? '' : 's'} sampled · ${reporting} reporting`,
    coverageTitle:
      `${reporting} of ${configured} configured venue(s) returned at least one event` +
      `${pct === null ? '' : ` (${pct} source coverage)`}. ` +
      'Totals are a lower bound across the sampled venues, never the market total.',
    partialCoverage: sampled < configured,
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

/** Attach the feed lineage and formula to client-side long/short aggregates. */
export function inspectLiquidationsSummary(
  events: LiquidationEvent[],
  inputReceipt: DataReceipt | undefined,
  evaluatedAtMs: number = Date.now(),
): InspectedLiquidationsSummary {
  const summary = summarizeLiquidations(events);
  if (inputReceipt === undefined) return { summary, receipt: null };
  try {
    return {
      summary,
      receipt: deriveDataReceipt(
        {
          providerId: 'midas-web',
          providerVersion: '1.0',
          source: 'Midas client liquidation reducer',
          venue: inputReceipt.venue,
          datasetFamily: 'liquidations',
          instrument: inputReceipt.instrument,
          coverage: `${events.length} liquidation event(s)`,
          provenance: inputReceipt.provenance,
          expectedCadenceMs: inputReceipt.expectedCadenceMs,
          units: { value: 'quote currency', percentage: 'percent', count: 'events' },
          methodology: {
            id: 'liquidation-side-summary',
            version: '1.0',
            formula:
              'event notional=price*amount; long=side sell, short=side buy; side totals=sum(event notional); side share=side total/(long total+short total)',
          },
          inputReceipts: [inputReceipt],
          note:
            inputReceipt.provenance === 'live'
              ? null
              : `Derived from ${inputReceipt.provenance} liquidation evidence.`,
        },
        evaluatedAtMs,
      ),
    };
  } catch {
    return { summary, receipt: null };
  }
}
