import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const SORTS: Array<{ key: string; label: string }> = [
  { key: 'volume', label: 'VOL' },
  { key: 'change', label: 'CHG%' },
  { key: 'price', label: 'PRICE' },
];

const QUOTES = ['USDT', 'BTC'];

export function ScreenerModule({ panel }: ModuleProps) {
  const [quote, setQuote] = useState('USDT');
  const [sort, setSort] = useState('volume');

  const { data, error, loading } = useFetch(
    (signal) => api.screener(quote, sort, 100, signal),
    [quote, sort],
    { intervalMs: 15_000 },
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs">
        <div className="flex gap-1">
          {QUOTES.map((qc) => (
            <button
              key={qc}
              onClick={() => setQuote(qc)}
              className={`rounded-sm px-1.5 py-0.5 ${
                quote === qc ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {qc}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <span className="text-term-dim">sort</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`rounded-sm px-1.5 py-0.5 ${
                sort === s.key ? 'text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading && !data && <Loading label="Screening" />}
        {error && !data && <ErrorMsg message={error} />}
        {data && data.length === 0 && <EmptyState>No {quote} markets.</EmptyState>}
        {data && data.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-right font-normal">LAST</th>
                <th className="px-2 py-1 text-right font-normal">CHG%</th>
                <th className="px-2 py-1 text-right font-normal">VOL</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.symbol} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, r.symbol)}
                    >
                      {r.symbol}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtPrice(r.price)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.changePercent)}`}>
                    {fmtSignedPercent(r.changePercent)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                    ${fmtCompact(r.quoteVolume)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
