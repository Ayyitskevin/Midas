import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { openSymbol } from '@/commands/execute';

const TAPE = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT'];

export function Ticker() {
  const watch = useWatchlist((s) => s.symbols);
  const symbols = Array.from(new Set([...TAPE, ...watch]));

  const { data } = useFetch(
    (signal) => api.quotes(symbols, signal),
    [symbols.join(',')],
    { intervalMs: 6000 },
  );
  const quotes = data ?? [];

  if (quotes.length === 0) {
    return <div className="h-6 border-y border-term-border bg-term-bg" />;
  }

  const items = quotes.map((q) => (
    <button
      key={q.symbol}
      onClick={() => openSymbol(q.symbol)}
      className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 hover:bg-term-header/60"
    >
      <span className="font-medium text-term-text">{q.symbol}</span>
      <span className="tabular-nums text-term-muted">{fmtPrice(q.price)}</span>
      <span className={`tabular-nums ${changeClass(q.changePercent)}`}>
        {fmtSignedPercent(q.changePercent)}
      </span>
    </button>
  ));

  return (
    <div className="relative h-6 overflow-hidden border-y border-term-border bg-term-bg text-2xs">
      <div className="absolute inset-y-0 flex items-center whitespace-nowrap will-change-transform animate-marquee hover:[animation-play-state:paused]">
        <div className="flex items-center">{items}</div>
        <div className="flex items-center" aria-hidden>
          {items}
        </div>
      </div>
    </div>
  );
}
