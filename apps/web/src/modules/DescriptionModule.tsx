import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import {
  changeClass,
  fmtCompact,
  fmtPrice,
  fmtSigned,
  fmtSignedPercent,
} from '@/lib/format';
import { openModule } from '@/commands/execute';
import { useWatchlist } from '@/store/useWatchlist';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

export function DescriptionModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data: quote, error, loading } = useFetch(
    (signal) => api.quote(symbol as string, signal),
    [symbol],
    { intervalMs: 5000, enabled: Boolean(symbol) },
  );

  const inWatch = useWatchlist((s) => (symbol ? s.symbols.includes(symbol) : false));
  const toggle = useWatchlist((s) => s.toggle);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !quote) return <Loading label={`Loading ${symbol}`} />;
  if (error && !quote) return <ErrorMsg message={error} />;
  if (!quote) return <EmptyState>No data for {symbol}.</EmptyState>;

  const stats: Array<[string, string]> = [
    ['Prev Close', fmtPrice(quote.previousClose)],
    ['Open', fmtPrice(quote.open)],
    ['Day High', fmtPrice(quote.dayHigh)],
    ['Day Low', fmtPrice(quote.dayLow)],
    ['52W High', fmtPrice(quote.fiftyTwoWeekHigh)],
    ['52W Low', fmtPrice(quote.fiftyTwoWeekLow)],
    ['Volume', fmtCompact(quote.volume)],
    ['Mkt Cap', fmtCompact(quote.marketCap)],
  ];

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-term-amber">{quote.symbol}</span>
            <span className="rounded-sm border border-term-border px-1 py-0.5 text-2xs text-term-muted">
              {quote.exchange || '—'}
            </span>
          </div>
          <div className="truncate text-xs text-term-muted">{quote.name}</div>
        </div>
        <button
          onClick={() => toggle(symbol)}
          title={inWatch ? 'Remove from watchlist' : 'Add to watchlist'}
          className="no-drag text-base leading-none"
        >
          <span className={inWatch ? 'text-term-amber' : 'text-term-dim'}>★</span>
        </button>
      </div>

      <div className="flex items-end gap-3">
        <span className="text-3xl font-semibold tabular-nums">{fmtPrice(quote.price)}</span>
        <span className={`pb-1 text-sm tabular-nums ${changeClass(quote.change)}`}>
          {fmtSigned(quote.change)} ({fmtSignedPercent(quote.changePercent)})
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        {stats.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between border-b border-term-border/40 py-0.5 text-xs"
          >
            <span className="text-term-muted">{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-2xs">
        <span className="rounded-sm bg-term-header px-1.5 py-0.5 uppercase tracking-wide text-term-muted">
          {quote.marketState}
        </span>
        <span className="text-term-dim">·</span>
        <span className="text-term-muted">{quote.currency}</span>
      </div>

      <div className="flex gap-1.5 pt-1">
        {['GP', 'GIP', 'N'].map((code) => (
          <button
            key={code}
            onClick={() => openModule(code, symbol)}
            className="no-drag rounded-sm border border-term-border px-2 py-1 text-2xs transition-colors hover:border-term-amber hover:text-term-amber"
          >
            {code}
          </button>
        ))}
      </div>
    </div>
  );
}
