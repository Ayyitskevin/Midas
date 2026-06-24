import type { Quote } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact, fmtPrice, fmtSigned, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { useWatchlist } from '@/store/useWatchlist';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

interface Column {
  key: string;
  label: string;
  render: (q: Quote) => string;
  className?: (q: Quote) => string;
}

const COLUMNS: Column[] = [
  { key: 'last', label: 'LAST', render: (q) => fmtPrice(q.price) },
  {
    key: 'chg',
    label: 'CHG',
    render: (q) => fmtSigned(q.change),
    className: (q) => changeClass(q.change),
  },
  {
    key: 'chgpct',
    label: 'CHG%',
    render: (q) => fmtSignedPercent(q.changePercent),
    className: (q) => changeClass(q.changePercent),
  },
  { key: 'open', label: 'OPEN', render: (q) => fmtPrice(q.open) },
  { key: 'high', label: 'HIGH', render: (q) => fmtPrice(q.dayHigh) },
  { key: 'low', label: 'LOW', render: (q) => fmtPrice(q.dayLow) },
  { key: 'vol', label: 'VOL', render: (q) => fmtCompact(q.volume) },
];

export function QuoteMonitorModule({ panel }: ModuleProps) {
  const symbols = useWatchlist((s) => s.symbols);
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.quotes(symbols, signal),
    [symbols.join(',')],
    { intervalMs: 4000, enabled: symbols.length > 0 },
  );
  const bySymbol = new Map((data ?? []).map((q) => [q.symbol, q]));

  if (symbols.length === 0) return <EmptyState>Watchlist is empty.</EmptyState>;
  if (loading && !data) return <Loading label="Loading quotes" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  return (
    <div className="scroll-term h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-term-panel">
          <tr className="text-2xs text-term-muted">
            <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-2 py-1 text-right font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((sym) => {
            const q = bySymbol.get(sym);
            return (
              <tr key={sym} className="border-b border-term-border/30 hover:bg-term-header/60">
                <td className="px-2 py-1">
                  <button
                    className="no-drag font-medium text-term-text hover:text-term-amber"
                    onClick={() => navigate(panel, sym)}
                  >
                    {sym}
                  </button>
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-1 text-right tabular-nums ${q && c.className ? c.className(q) : ''}`}
                  >
                    {q ? c.render(q) : '—'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
