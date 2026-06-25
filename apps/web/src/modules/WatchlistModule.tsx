import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { useWatchlist } from '@/store/useWatchlist';
import { Loading, ErrorMsg } from '@/components/Feedback';
import { Sparkline } from '@/components/Sparkline';
import type { ModuleProps } from './types';

/** Recent close series per symbol for the sparkline column (24h of hourly candles). */
function useSparklines(symbols: string[]): Map<string, number[]> {
  const [series, setSeries] = useState<Map<string, number[]>>(() => new Map());
  const key = symbols.join(',');
  useEffect(() => {
    if (symbols.length === 0) {
      setSeries(new Map());
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const load = () => {
      Promise.all(
        symbols.map((s) =>
          api
            .history(s, '60m', '1d', controller.signal)
            .then((h) => [s, h.candles.map((c) => c.close)] as const)
            .catch(() => [s, [] as number[]] as const),
        ),
      ).then((entries) => {
        if (!cancelled) setSeries(new Map(entries));
      });
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
    // Re-fetch only when the symbol set changes (not on every quote tick).
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return series;
}

/** Subtle background tint scaled by |% change| (capped), tracking the up/down hue. */
function heatStyle(pct: number | undefined): CSSProperties | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  const mag = Math.min(Math.abs(pct), 8) / 8; // saturate at ±8%
  if (mag < 0.05) return undefined;
  const rgb = pct >= 0 ? '38,194,129' : '239,77,86';
  return { backgroundColor: `rgba(${rgb},${(mag * 0.28).toFixed(3)})` };
}

export function WatchlistModule({ panel }: ModuleProps) {
  const symbols = useWatchlist((s) => s.symbols);
  const remove = useWatchlist((s) => s.remove);
  const add = useWatchlist((s) => s.add);
  const lists = useWatchlist((s) => s.lists);
  const activeId = useWatchlist((s) => s.activeId);
  const switchList = useWatchlist((s) => s.switchList);
  const addList = useWatchlist((s) => s.addList);
  const renameList = useWatchlist((s) => s.renameList);
  const removeList = useWatchlist((s) => s.removeList);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const commitRename = (id: string) => {
    renameList(id, editName);
    setEditingId(null);
  };

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.quotes(symbols, signal),
    [symbols.join(',')],
    { intervalMs: 5000, enabled: symbols.length > 0 },
  );
  const bySymbol = new Map((data ?? []).map((q) => [q.symbol, q]));
  const spark = useSparklines(symbols);

  return (
    <div className="flex h-full flex-col">
      <div className="no-drag flex items-center gap-0.5 overflow-x-auto border-b border-term-border px-1 py-0.5 text-2xs scroll-term">
        {lists.map((l) => {
          const active = l.id === activeId;
          if (editingId === l.id) {
            return (
              <input
                key={l.id}
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => commitRename(l.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(l.id);
                  else if (e.key === 'Escape') setEditingId(null);
                }}
                placeholder={l.name}
                className="w-20 rounded-sm border border-term-amber bg-transparent px-1 py-0.5 text-term-text outline-none"
              />
            );
          }
          return (
            <span
              key={l.id}
              onClick={() => switchList(l.id)}
              onDoubleClick={() => {
                setEditingId(l.id);
                setEditName(l.name);
              }}
              title="Click to switch · double-click to rename"
              className={`group flex shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 ${
                active ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {l.name}
              {lists.length > 1 && (
                <button
                  className="text-term-dim opacity-0 transition-opacity hover:text-term-down group-hover:opacity-100"
                  title="Remove list"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeList(l.id);
                  }}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <button
          className="shrink-0 px-1.5 py-0.5 text-term-dim hover:text-term-amber"
          title="New list"
          onClick={() => {
            const id = addList();
            setEditingId(id);
            setEditName('');
          }}
        >
          +
        </button>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel">
            <tr className="text-2xs text-term-muted">
              <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
              <th className="px-2 py-1 text-right font-normal">LAST</th>
              <th className="px-2 py-1 text-right font-normal">CHG%</th>
              <th className="px-2 py-1 text-right font-normal">1D</th>
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
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${changeClass(q?.changePercent)}`}
                    style={heatStyle(q?.changePercent)}
                  >
                    {q ? fmtSignedPercent(q.changePercent) : '—'}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex justify-end">
                      <Sparkline values={spark.get(sym) ?? []} />
                    </div>
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
        {error && !data && <ErrorMsg message={error} onRetry={refresh} />}
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
