import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { sparklinePath } from '@/lib/sparkline';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { SourceBadge } from '@/components/SourceInspector';
import { isReceiptActionable } from '@/lib/receiptView';
import { OI_DELTA_WINDOWS, type OiDeltaClassification, type OiDeltaWindow } from '@midas/shared';
import type { ModuleProps } from './types';

type LegacyTone = 'live' | 'synthetic' | 'unavailable';

const TONE: Record<LegacyTone, string> = {
  live: 'border-term-border text-term-muted',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

/**
 * Quadrant styling: buildups (new positioning entering) read saturated —
 * long buildup green, short buildup red; unwinds (positioning closing out)
 * read amber — a short-covering rally or a long-unwind sell-off is a fade, not
 * fresh conviction.
 */
const QUADRANT: Record<OiDeltaClassification, { label: string; cls: string }> = {
  'long-buildup': { label: 'LONG BUILDUP', cls: 'border-term-up/50 text-term-up' },
  'short-buildup': { label: 'SHORT BUILDUP', cls: 'border-term-down/50 text-term-down' },
  'long-unwind': { label: 'LONG UNWIND', cls: 'border-term-amber/50 text-term-amber' },
  'short-covering': { label: 'SHORT COVERING', cls: 'border-term-amber/50 text-term-amber' },
};

/** Signed percent, e.g. +2.35% / −1.10%; em-dash for null. */
function fmtPct(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Green for a gain, red for a loss, dim for unknown. */
function changeCls(pct: number | null): string {
  if (pct == null) return 'text-term-dim';
  return pct > 0 ? 'text-term-up' : pct < 0 ? 'text-term-down' : 'text-term-muted';
}

/**
 * OID — OI-delta positioning: open-interest CHANGE vs price CHANGE over a
 * window, the classic four-quadrant read (long buildup / short buildup / long
 * unwind / short covering) that a static OI snapshot (OIV, FUND) cannot give.
 * Per-payload provenance badge; a venue with no OI-history read shows the
 * honest unavailable note, never a delta synthesized from two snapshots.
 */
export function OidModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [window, setWindow] = useState<OiDeltaWindow>('24h');
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.oiDelta(symbol as string, window, signal),
    [symbol, window],
    { intervalMs: 60_000, enabled: Boolean(symbol) },
  );

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} OI delta`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!data) return <EmptyState>No OI delta for {symbol}.</EmptyState>;

  // Legacy fallback only. Unlike the options helper, OID must name its actual
  // selected CCXT source rather than claiming every live read is Deribit.
  const legacyBadge: { label: string; tone: LegacyTone; detail: string } =
    data.provenance === 'live'
      ? {
          label: `live · ${data.source || 'unknown source'}`,
          tone: 'live',
          detail: data.note ?? `Live OI history from ${data.source || 'an unknown source'}.`,
        }
      : data.provenance === 'synthetic'
        ? {
            label: 'synthetic',
            tone: 'synthetic',
            detail: data.note ?? 'Synthetic OI history — not real market data.',
          }
        : {
            label: 'unavailable',
            tone: 'unavailable',
            detail: data.note ?? 'OI history unavailable.',
          };
  const quadrant = data.classification ? QUADRANT[data.classification] : null;
  const actionable = isReceiptActionable(data.receipt);
  const spark = sparklinePath(
    data.points.map((p) => p.openInterestValue),
    240,
    48,
  );
  const lastPrice = [...data.points].reverse().find((p) => p.price != null)?.price ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">{data.symbol}</span>
        {quadrant ? (
          <span className={`rounded-sm border px-1.5 py-0.5 font-semibold ${actionable ? quadrant.cls : 'border-term-border text-term-muted'}`}>{quadrant.label}</span>
        ) : (
          <span className="text-term-dim">no clear quadrant</span>
        )}
        {data.receipt ? (
          <SourceBadge receipt={data.receipt} compact className="ml-auto" />
        ) : (
          <span
            className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[legacyBadge.tone]}`}
            title={legacyBadge.tone === 'live' ? `${legacyBadge.detail} Freshness is unknown because this legacy payload has no receipt.` : legacyBadge.detail}
          >
            {legacyBadge.label}{legacyBadge.tone === 'live' ? ' · freshness unknown' : ''}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-term-border px-2 py-1 text-2xs">
        <span className="mr-1 text-term-dim">window</span>
        {OI_DELTA_WINDOWS.map((w) => (
          <button
            key={w}
            className={`no-drag rounded-sm px-1.5 py-0.5 ${
              w === data.window ? 'bg-term-header font-semibold text-term-amber' : 'text-term-muted hover:text-term-text'
            }`}
            onClick={() => setWindow(w)}
          >
            {w}
          </button>
        ))}
      </div>

      {data.points.length === 0 ? (
        <EmptyState>{data.note ?? `No OI history for ${symbol}.`}</EmptyState>
      ) : (
        <div className="scroll-term flex-1 overflow-auto">
          <div className="grid grid-cols-2 gap-x-4 px-2 py-2 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-term-muted">OI NOW</span>
              <span className="tabular-nums text-term-text">${fmtCompact(data.oiNow)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-term-muted">OI {data.window} AGO</span>
              <span className="tabular-nums text-term-text">{data.oiThen == null ? '—' : `$${fmtCompact(data.oiThen)}`}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-term-muted">Δ OI</span>
              <span className={`tabular-nums font-semibold ${actionable ? changeCls(data.oiChangePct) : 'text-term-muted'}`}>
                {fmtPct(data.oiChangePct)}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-term-muted">Δ PRICE</span>
              <span className={`tabular-nums font-semibold ${actionable ? changeCls(data.priceChangePct) : 'text-term-muted'}`}>
                {fmtPct(data.priceChangePct)}
              </span>
            </div>
          </div>
          <div className="px-2 pb-1">
            {spark ? (
              <svg width="100%" height="48" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden>
                <path d={spark} fill="none" stroke="currentColor" strokeWidth="1" className={actionable ? 'text-term-amber' : 'text-term-muted'} />
              </svg>
            ) : (
              <span className="text-2xs text-term-dim">no history</span>
            )}
            <div className="flex justify-between text-2xs text-term-dim">
              <span>OI {data.window}</span>
              <span>{lastPrice == null ? '' : `last ${fmtPrice(lastPrice)}`}</span>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        OI↑+price↑ = <span className={actionable ? 'text-term-up' : 'text-term-muted'}>long buildup</span> · OI↑+price↓ ={' '}
        <span className={actionable ? 'text-term-down' : 'text-term-muted'}>short buildup</span> · OI↓ = <span className={actionable ? 'text-term-amber' : 'text-term-muted'}>unwind / covering</span>
      </div>
    </div>
  );
}
