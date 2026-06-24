import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice, fmtTimeAgo } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { summarizeLiquidations } from '@/lib/liquidations';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

export function LiquidationsModule({ panel }: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.liquidations('USDT', 30, signal),
    [],
    { intervalMs: 8000 },
  );

  const summary = useMemo(() => summarizeLiquidations(data ?? []), [data]);
  const longPct = summary.total > 0 ? (summary.longValue / summary.total) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-amber">LIQUIDATIONS</span>
        <span className="text-term-dim">perps · live</span>
      </div>

      {/* Long vs short summary */}
      <div className="border-b border-term-border px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-2xs tabular-nums">
          <span className="text-term-down">
            LONG ${fmtCompact(summary.longValue)} <span className="text-term-dim">({summary.longCount})</span>
          </span>
          <span className="text-term-up">
            <span className="text-term-dim">({summary.shortCount})</span> ${fmtCompact(summary.shortValue)} SHORT
          </span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-sm bg-term-up">
          <div className="bg-term-down" style={{ width: `${longPct}%` }} title={`Longs ${longPct.toFixed(0)}%`} />
        </div>
      </div>

      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Loading liquidations" />}
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
        {data && data.length === 0 && <EmptyState>No recent liquidations.</EmptyState>}
        {data && data.length > 0 && (
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
              {data.map((l, i) => {
                const isLong = l.side === 'sell';
                return (
                  <tr key={`${l.symbol}-${l.timestamp}-${i}`} className="border-b border-term-border/30 hover:bg-term-header/60">
                    <td className={`px-2 py-0.5 font-medium ${isLong ? 'text-term-down' : 'text-term-up'}`}>
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
