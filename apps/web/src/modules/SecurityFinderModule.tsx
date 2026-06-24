import { useEffect, useState } from 'react';
import type { SearchResult } from '@midas/shared';
import { api } from '@/lib/api';
import { openSymbol } from '@/commands/execute';
import { useWatchlist } from '@/store/useWatchlist';
import { Loading, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

export function SecurityFinderModule({ panel }: ModuleProps) {
  const initial = (panel.params?.query as string) ?? '';
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const add = useWatchlist((s) => s.add);
  const symbols = useWatchlist((s) => s.symbols);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .search(q, controller.signal)
        .then((r) => {
          if (!controller.signal.aborted) {
            setResults(r);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <div className="no-drag border-b border-term-border p-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker or name…"
          className="w-full rounded-sm bg-term-header px-2 py-1 text-xs outline-none placeholder:text-term-dim"
        />
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        {loading && results.length === 0 && <Loading label="Searching" />}
        {!loading && query.trim() && results.length === 0 && (
          <EmptyState>No matches for “{query}”.</EmptyState>
        )}
        <ul>
          {results.map((r) => {
            const inWatch = symbols.includes(r.symbol);
            return (
              <li
                key={r.symbol}
                className="group flex items-center justify-between gap-2 border-b border-term-border/30 px-3 py-1.5 hover:bg-term-header/60"
              >
                <button className="no-drag min-w-0 text-left" onClick={() => openSymbol(r.symbol)}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-term-amber">{r.symbol}</span>
                    <span className="text-2xs text-term-dim">{r.exchange}</span>
                    <span className="rounded-sm border border-term-border px-1 text-2xs text-term-muted">
                      {r.type}
                    </span>
                  </div>
                  <div className="truncate text-2xs text-term-muted">{r.name}</div>
                </button>
                <button
                  className="no-drag text-base leading-none"
                  title={inWatch ? 'In watchlist' : 'Add to watchlist'}
                  onClick={() => add(r.symbol)}
                >
                  <span className={inWatch ? 'text-term-amber' : 'text-term-dim group-hover:text-term-muted'}>
                    ★
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
