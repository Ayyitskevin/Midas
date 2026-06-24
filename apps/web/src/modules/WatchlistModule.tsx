import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { useWatchlist } from '@/store/useWatchlist';
import { Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

export function WatchlistModule({ panel }: ModuleProps) {
  const symbols = useWatchlist((s) => s.symbols);
  const remove = useWatchlist((s) => s.remove);
  const add = useWatchlist((s) => s.add);
  const [input, setInput] = useState('');

  const { data, error, loading } = useFetch(
    (signal) => api.quotes(symbols, signal),
    [symbols.join(',')],
    { intervalMs: 5000, enabled: symbols.length > 0 },
  );
  const bySymbol = new Map((data ?? []).map((q) => [q.symbol, q]));

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-term flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel">
            <tr className="text-2xs text-term-muted">
              <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
              <th className="px-2 py-1 text-right font-normal">LAST</th>
              <th className="px-2 py-1 text-right font-normal">CHG%</th>
              <th className="px-1" />
            </tr>
          </thead>
          <tbody>
            {symbols.map((sym) => {
              const q = bySymbol.get(sym);
              return (
                <tr
                  key={sym}
                  className="group border-b border-term-border/30 hover:bg-term-header/60"
                >
                  <td className="px-2 py-1">
                    <button
                      className="no-drag font-medium text-term-text hover:text-term-amber"
                      onClick={() => navigate(panel, sym)}
                    >
                      {sym}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {q ? fmtPrice(q.price) : '—'}
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(q?.changePercent)}`}>
                    {q ? fmtSignedPercent(q.changePercent) : '—'}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      className="no-drag text-term-dim opacity-0 transition-opacity hover:text-term-down group-hover:opacity-100"
                      title="Remove"
                      onClick={() => remove(sym)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {symbols.length === 0 && (
          <div className="p-3 text-2xs text-term-muted">Watchlist empty — add a symbol below.</div>
        )}
        {loading && !data && <Loading label="Loading quotes" />}
        {error && !data && <ErrorMsg message={error} />}
      </div>
      <form
        className="no-drag flex border-t border-term-border"
        onSubmit={(e) => {
          e.preventDefault();
          add(input);
          setInput('');
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add symbol…"
          className="flex-1 bg-transparent px-2 py-1 text-xs uppercase outline-none placeholder:text-term-dim placeholder:normal-case"
        />
        <button type="submit" className="px-3 text-sm text-term-amber" title="Add">
          +
        </button>
      </form>
    </div>
  );
}
