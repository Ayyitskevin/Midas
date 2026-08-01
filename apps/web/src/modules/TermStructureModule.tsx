import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice } from '@/lib/format';
import { classifyTermStructure, fmtBasis, fmtDays, fmtExpiry, optionsBadge, type OptionsTone } from '@/lib/optionsView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<OptionsTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

/**
 * TERM — the dated-futures term structure for a symbol: every listed expiry
 * with its annualized basis vs the perpetual, so the calendar curve reads as
 * contango (futures rich) or backwardation (futures cheap). The perp sits at
 * the top of the table for comparison. Provenance is badged per payload; a
 * venue with no dated futures shows the honest note, never an empty "live"
 * board.
 */
export function TermStructureModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.termStructure(symbol as string, signal),
    [symbol],
    { intervalMs: 30_000, enabled: Boolean(symbol) },
  );

  const shape = useMemo(() => (data ? classifyTermStructure(data) : null), [data]);
  const badge = data ? optionsBadge(data.provenance, data.note) : null;

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} term structure`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!data) return <EmptyState>No term structure for {symbol}.</EmptyState>;

  const shapeCls =
    shape === 'contango' ? 'text-term-up' : shape === 'backwardation' ? 'text-term-down' : 'text-term-amber';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">{data.underlying}</span>
        <span className="text-term-dim">dated futures vs perp</span>
        {shape && <span className={`font-semibold ${shapeCls}`}>{shape}</span>}
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      {data.points.length === 0 ? (
        <EmptyState>{data.note ?? `No dated futures for ${data.underlying}.`}</EmptyState>
      ) : (
        <div className="scroll-term flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                <th className="px-2 py-1 text-left font-normal">EXPIRY</th>
                <th className="px-2 py-1 text-left font-normal">CONTRACT</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">TTE</th>
                <th className="px-2 py-1 text-right font-normal" title="Annualized basis vs the perpetual (positive = contango)">
                  ANN. BASIS
                </th>
              </tr>
            </thead>
            <tbody>
              {data.perpPrice != null && (
                <tr className="border-b border-term-border bg-term-header/40">
                  <td className="px-2 py-1 text-term-muted">PERP</td>
                  <td className="px-2 py-1 text-term-dim">perpetual</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-text">{fmtPrice(data.perpPrice)}</td>
                  <td className="px-2 py-1 text-right text-term-dim">—</td>
                  <td className="px-2 py-1 text-right text-term-dim" title="The basis reference">
                    ref
                  </td>
                </tr>
              )}
              {data.points.map((p) => (
                <tr key={p.futureSymbol} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1 text-term-text">{fmtExpiry(p.expiry)}</td>
                  <td className="px-2 py-1 text-term-dim">{p.futureSymbol}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtPrice(p.price)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtDays(p.daysToExpiry)}</td>
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${
                      p.annualizedBasisPct > 0.5
                        ? 'text-term-up'
                        : p.annualizedBasisPct < -0.5
                          ? 'text-term-down'
                          : 'text-term-muted'
                    }`}
                  >
                    {fmtBasis(p.annualizedBasisPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Annualized simple basis vs the perpetual · <span className="text-term-up">green</span> = contango /{' '}
        <span className="text-term-down">red</span> = backwardation · Deribit dated futures
      </div>
    </div>
  );
}
