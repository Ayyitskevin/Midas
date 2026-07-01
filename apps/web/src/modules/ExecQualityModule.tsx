import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAccountRefresh } from '@/lib/accountBus';
import { fmtCompact } from '@/lib/format';
import { fillsBadge, type AccountTone } from '@/lib/accountReadsView';
import { computeExecQuality } from '@/lib/execQuality';
import { fmtBps } from '@/lib/postTradeSlippage';
import { useFillBaselines } from '@/store/useFillBaselines';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<AccountTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-sm border border-term-border bg-term-panel/50 px-2 py-1">
      <div className="text-2xs uppercase tracking-wide text-term-dim">{label}</div>
      <div
        className={`font-mono text-sm ${tone === 'up' ? 'text-term-up' : tone === 'down' ? 'text-term-down' : 'text-term-text'}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * XQL — execution quality from your own fills: maker/taker mix, fee totals,
 * and realized slippage vs the TICKET estimates recorded in this browser.
 * Symbol-aware for venues that only serve fills per symbol (BTC/USDT XQL).
 */
export function ExecQualityModule({ panel }: ModuleProps) {
  const symbol = panel.symbol ?? undefined;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.fills(symbol, signal),
    [symbol],
    { intervalMs: 30_000 },
  );
  useAccountRefresh(refresh);
  const baselines = useFillBaselines((s) => s.baselines);

  const q = useMemo(
    () => (data ? computeExecQuality(data.fills, baselines) : null),
    [data, baselines],
  );
  const badge = data ? fillsBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Execution quality</span>
        <span className="text-term-dim">{symbol ?? 'all symbols'}</span>
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto p-2">
        {loading && !data ? (
          <Loading label="Loading fills" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || !q || q.fills === 0 ? (
          <EmptyState>{data?.note ?? 'No fills to analyze yet.'}</EmptyState>
        ) : (
          <>
            <div className="mb-2 grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Tile label="Fills" value={String(q.fills)} />
              <Tile label="Notional" value={fmtCompact(q.notional)} />
              <Tile label="Maker %" value={q.makerPct == null ? '—' : `${q.makerPct.toFixed(0)}%`} />
              <Tile
                label={`Avg slip (${q.slipCoveragePct.toFixed(0)}% covered)`}
                value={q.avgSlipBps == null ? '—' : fmtBps(q.avgSlipBps)}
                tone={q.avgSlipBps == null ? undefined : q.avgSlipBps > 0 ? 'down' : 'up'}
              />
            </div>

            {q.feeTotals.length > 0 && (
              <div className="mb-2 text-2xs text-term-muted">
                Fees paid:{' '}
                <span className="font-mono text-term-text">
                  {q.feeTotals
                    .map((f) => `${f.total.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${f.currency}`)
                    .join(' · ')}
                </span>
              </div>
            )}

            <table className="w-full text-2xs tabular-nums">
              <thead className="sticky top-0 bg-term-panel">
                <tr className="text-term-muted">
                  <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                  <th className="px-2 py-1 text-right font-normal">FILLS</th>
                  <th className="px-2 py-1 text-right font-normal">NOTIONAL</th>
                  <th
                    className="px-2 py-1 text-right font-normal"
                    title="Notional-weighted realized slippage vs TICKET estimates recorded in this browser. + = worse."
                  >
                    AVG SLIP
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.bySymbol.map((s) => (
                  <tr key={s.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 text-term-text">{s.symbol}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{s.fills}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{fmtCompact(s.notional)}</td>
                    <td
                      className={`px-2 py-0.5 text-right ${
                        s.avgSlipBps == null ? 'text-term-dim' : s.avgSlipBps > 0 ? 'text-term-down' : 'text-term-up'
                      }`}
                    >
                      {s.avgSlipBps == null ? '—' : fmtBps(s.avgSlipBps)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-2 px-1 text-2xs leading-relaxed text-term-dim">
              Slippage compares fills against the estimates TICKET recorded in this browser at placement — fills
              placed elsewhere have no baseline and are excluded from the averages (the coverage % says how much).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
