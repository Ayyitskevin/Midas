import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtTimeAgo } from '@/lib/format';
import { openSymbol } from '@/commands/execute';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

export function NewsModule({ panel }: ModuleProps) {
  const symbol = panel.symbol ?? undefined;
  const { data, error, loading } = useFetch(
    (signal) => api.news(symbol, signal),
    [symbol ?? 'MARKET'],
    { intervalMs: 60_000 },
  );

  if (loading && !data) return <Loading label="Loading headlines" />;
  if (error && !data) return <ErrorMsg message={error} />;
  if (!data || data.length === 0) return <EmptyState>No headlines.</EmptyState>;

  return (
    <div className="scroll-term h-full overflow-auto">
      <ul className="divide-y divide-term-border/40">
        {data.map((item) => (
          <li key={item.id} className="px-3 py-2 hover:bg-term-header/40">
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="no-drag block text-xs leading-snug text-term-text hover:text-term-amber"
            >
              {item.title}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-term-muted">
              <span>{item.publisher}</span>
              <span className="text-term-dim">·</span>
              <span>{fmtTimeAgo(item.publishedAt)}</span>
              {item.relatedSymbols.slice(0, 4).map((sym) => (
                <button
                  key={sym}
                  onClick={() => openSymbol(sym)}
                  className="no-drag rounded-sm bg-term-header px-1 py-0.5 text-term-accent hover:text-term-amber"
                >
                  {sym}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
