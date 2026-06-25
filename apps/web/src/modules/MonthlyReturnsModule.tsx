import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { monthlyGrid } from '@/lib/monthlyReturns';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Green (gain) / red (loss) cell, opacity scaled by |return| up to `cap`. */
function cellColor(ret: number | null, cap = 0.25): string | undefined {
  if (ret == null || !Number.isFinite(ret)) return undefined;
  const t = Math.max(-1, Math.min(1, ret / cap));
  const alpha = (0.1 + 0.55 * Math.abs(t)).toFixed(3);
  return `rgba(${ret >= 0 ? '38,194,129' : '239,77,86'},${alpha})`;
}

const pct = (v: number | null) => (v == null ? '' : `${v >= 0 ? '' : '−'}${Math.abs(v * 100).toFixed(0)}`);

export function MonthlyReturnsModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.history(symbol!, '1mo', '5y', signal),
    [symbol],
    { enabled: !!symbol },
  );

  const grid = useMemo(() => (data ? monthlyGrid(data.candles) : null), [data]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!grid || grid.years.length === 0) return <EmptyState>Not enough history for monthly returns.</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">monthly returns · month-over-month %</span>
        <span className="ml-auto tabular-nums text-term-dim">
          best <span className="text-term-up">{pct(grid.best)}</span> · worst{' '}
          <span className="text-term-down">{pct(grid.worst)}</span>
        </span>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto p-1">
        <table className="w-full border-separate text-center text-2xs tabular-nums" style={{ borderSpacing: 2 }}>
          <thead>
            <tr className="text-term-muted">
              <th className="px-1 py-0.5 text-left font-normal">YR</th>
              {MONTHS.map((m) => (
                <th key={m} className="px-1 py-0.5 font-normal">
                  {m[0]}
                </th>
              ))}
              <th className="px-1 py-0.5 font-normal text-term-text">YR%</th>
            </tr>
          </thead>
          <tbody>
            {grid.years.map((row) => (
              <tr key={row.year}>
                <td className="px-1 py-0.5 text-left text-term-muted">{row.year}</td>
                {row.months.map((m, i) => (
                  <td
                    key={i}
                    title={`${MONTHS[i]} ${row.year}: ${m == null ? 'n/a' : `${(m * 100).toFixed(1)}%`}`}
                    className="rounded-sm px-1 py-0.5 text-term-text"
                    style={{ backgroundColor: cellColor(m) }}
                  >
                    {pct(m)}
                  </td>
                ))}
                <td
                  className="rounded-sm px-1 py-0.5 font-semibold text-term-text"
                  style={{ backgroundColor: cellColor(row.total, 0.6) }}
                >
                  {pct(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Each cell is the month's return (end-to-end); YR% compounds the year's months · green gain / red loss
      </div>
    </div>
  );
}
