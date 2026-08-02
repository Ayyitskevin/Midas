import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice, fmtTimeAgo } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { inspectLiquidationSources, inspectLiquidationsSummary, liquidationsFeedBadge } from '@/lib/liquidations';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { SourceBadge } from '@/components/SourceInspector';
import { isReceiptActionable } from '@/lib/receiptView';
import { isPartialEvidenceLimitation } from '@midas/shared';
import type { ModuleProps } from './types';

export function LiquidationsModule({ panel }: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.liquidations('USDT', 30, signal),
    [],
    { intervalMs: 8000 },
  );

  const events = useMemo(() => data?.events ?? [], [data]);
  const meta = data?.meta;
  const receipt = meta?.receipt ?? data?.receipt;
  const badge = meta ? liquidationsFeedBadge(meta) : null;
  const sources = useMemo(() => inspectLiquidationSources(meta), [meta]);
  const inspected = useMemo(
    () => inspectLiquidationsSummary(events, receipt),
    [events, receipt],
  );
  const summary = inspected.summary;
  const actionable = isReceiptActionable(inspected.receipt);
  const partialEvidence = Boolean(receipt?.limitations.some(isPartialEvidenceLimitation));
  const longPct = summary.total > 0 ? (summary.longValue / summary.total) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">LIQUIDATIONS</span>
        {receipt ? (
          <SourceBadge receipt={receipt} />
        ) : meta && badge ? (
          <span className="flex items-center gap-1 text-term-dim">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                badge.liveTone ? 'bg-term-dim' : 'bg-term-amber'
              }`}
              title={badge.liveTone ? `${badge.title} Freshness unknown: no receipt.` : badge.title}
            />
            <span className="text-term-muted">{meta.source}</span>
            <span>
              ·{' '}
              {badge.label === 'demo' ? 'demo' : badge.label === 'live' ? 'live · freshness unknown' : 'no feed'}
            </span>
            <span>· {fmtTimeAgo(meta.asOf)}</span>
          </span>
        ) : null}
      </div>

      {/* Honesty banner — why the feed may be empty/partial or under-reported. */}
      {meta?.note && badge && (
        <div
          className={`border-b px-2 py-1 text-2xs leading-snug ${
            badge.liveTone
              ? 'border-term-border text-term-dim'
              : 'border-term-amber/40 bg-term-amber/10 text-term-amber'
          }`}
        >
          ⚠ {meta.note}
        </div>
      )}

      {/* Per-source coverage — how many configured venues this feed actually
          reads, and each one's throttle/staleness state. A single-venue read
          presented without this reads as "the market". */}
      {sources && (
        <div className="border-b border-term-border px-2 py-1 text-2xs">
          <div
            className={`mb-0.5 ${sources.partialCoverage ? 'text-term-amber' : 'text-term-dim'}`}
            title={sources.coverageTitle}
          >
            SOURCES · {sources.coverageLabel}
            {sources.multipleLabel && (
              <>
                {' · '}
                <span className="text-term-amber" title={sources.multipleTitle ?? undefined}>
                  {sources.multipleLabel}
                </span>
                <span className="text-term-dim"> (lower bound)</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {sources.rows.map((row) => (
              <span key={row.source} className="flex items-center gap-1" title={row.detail}>
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    row.tone === 'ok' ? 'bg-term-up' : row.tone === 'warn' ? 'bg-term-amber' : 'bg-term-dim'
                  }`}
                />
                <span className="text-term-muted">{row.source}</span>
                <span className={row.tone === 'warn' ? 'text-term-amber' : 'text-term-dim'}>{row.state}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Long vs short summary */}
      {data && events.length > 0 && meta?.available === true && receipt?.provenance !== 'unavailable' && (
        <div className="border-b border-term-border px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between text-2xs tabular-nums">
            <span className={actionable ? 'text-term-down' : 'text-term-muted'}>
              LONG ${fmtCompact(summary.longValue)} <span className="text-term-dim">({summary.longCount})</span>
            </span>
            {inspected.receipt && <SourceBadge receipt={inspected.receipt} compact />}
            <span className={actionable ? 'text-term-up' : 'text-term-muted'}>
              <span className="text-term-dim">({summary.shortCount})</span> ${fmtCompact(summary.shortValue)} SHORT
            </span>
          </div>
          <div className={`flex h-1.5 overflow-hidden rounded-sm ${actionable ? 'bg-term-up' : 'bg-term-border'}`}>
            <div className={actionable ? 'bg-term-down' : 'bg-term-muted'} style={{ width: `${longPct}%` }} title={`Longs ${longPct.toFixed(0)}%`} />
          </div>
        </div>
      )}

      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading liquidations" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && events.length === 0 && (
          <EmptyState>
            {meta && !meta.available
              ? 'This source publishes no liquidation feed — connect an exchange that does.'
              : partialEvidence
                ? 'Liquidation evidence is partial; no complete event result can be asserted.'
              : 'No liquidations in the recent window.'}
          </EmptyState>
        )}
        {events.length > 0 && (
          <table className="w-full text-2xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SIDE</th>
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">VALUE</th>
                <th className="px-2 py-1 text-right font-normal">TIME</th>
              </tr>
            </thead>
            <tbody>
              {events.map((l, i) => {
                const isLong = l.side === 'sell';
                return (
                  <tr key={`${l.symbol}-${l.timestamp}-${i}`} className="border-b border-term-border/30 hover:bg-term-header/60">
                    <td className={`px-2 py-0.5 font-medium ${actionable ? (isLong ? 'text-term-down' : 'text-term-up') : 'text-term-muted'}`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </td>
                    <td className="px-2 py-0.5">
                      <button
                        className="no-drag text-term-text hover:text-term-amber"
                        onClick={() => navigate(panel, l.symbol)}
                      >
                        {l.symbol}
                      </button>
                    </td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtPrice(l.price)}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums text-term-muted">${fmtCompact(l.value)}</td>
                    <td className="px-2 py-0.5 text-right text-term-dim">{fmtTimeAgo(l.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
