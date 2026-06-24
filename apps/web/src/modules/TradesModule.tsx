import { useCallback, useEffect, useState } from 'react';
import type { Trade } from '@midas/shared';
import { useStream } from '@/lib/stream';
import { fmtPrice } from '@/lib/format';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 60;

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false });
}

export function TradesModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    setTrades([]);
  }, [symbol]);

  const onTrade = useCallback((data: unknown) => {
    setTrades((prev) => [data as Trade, ...prev].slice(0, MAX));
  }, []);
  useStream('trades', symbol, onTrade);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  return (
    <div className="scroll-term h-full overflow-auto">
      <table className="w-full text-2xs">
        <thead className="sticky top-0 bg-term-panel">
          <tr className="text-term-muted">
            <th className="px-2 py-1 text-left font-normal">TIME</th>
            <th className="px-2 py-1 text-right font-normal">PRICE</th>
            <th className="px-2 py-1 text-right font-normal">SIZE</th>
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 && (
            <tr>
              <td colSpan={3} className="p-3 text-term-muted">
                Waiting for prints…
              </td>
            </tr>
          )}
          {trades.map((t, i) => (
            <tr key={`${t.timestamp}-${i}`} className="border-b border-term-border/20">
              <td className="px-2 py-0.5 text-term-dim">{fmtClock(t.timestamp)}</td>
              <td
                className={`px-2 py-0.5 text-right tabular-nums ${
                  t.side === 'buy' ? 'text-term-up' : 'text-term-down'
                }`}
              >
                {fmtPrice(t.price)}
              </td>
              <td className="px-2 py-0.5 text-right tabular-nums text-term-muted">{t.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
