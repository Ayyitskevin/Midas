import { useCallback, useState } from 'react';
import type { Quote } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useStream } from '@/lib/stream';
import { useWatchlist } from '@/store/useWatchlist';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { openSymbol } from '@/commands/execute';

const TAPE = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT'];

function TickerItem({ quote }: { quote: Quote }) {
  const [live, setLive] = useState<{ price: number; changePercent: number } | null>(null);
  useStream(
    'ticker',
    quote.symbol,
    useCallback((d: unknown) => setLive(d as { price: number; changePercent: number }), []),
  );
  const price = live?.price ?? quote.price;
  const chg = live?.changePercent ?? quote.changePercent;
  return (
    <button
      onClick={() => openSymbol(quote.symbol)}
      className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 hover:bg-term-header/60"
    >
      <span className="font-medium text-term-text">{quote.symbol}</span>
      <span className="tabular-nums text-term-muted">{fmtPrice(price)}</span>
      <span className={`tabular-nums ${changeClass(chg)}`}>{fmtSignedPercent(chg)}</span>
    </button>
  );
}

export function Ticker() {
  const watch = useWatchlist((s) => s.symbols);
  const symbols = Array.from(new Set([...TAPE, ...watch]));

  // REST seeds names + initial prices; per-symbol ticker streams keep them live.
  const { data } = useFetch(
    (signal) => api.quotes(symbols, signal),
    [symbols.join(',')],
    { intervalMs: 30_000 },
  );
  const quotes = data ?? [];

  if (quotes.length === 0) {
    return <div className="h-6 border-y border-term-border bg-term-bg" />;
  }

  const items = quotes.map((q) => <TickerItem key={q.symbol} quote={q} />);

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
