import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtCompact, fmtPrice, fmtTimeAgo } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

function fmtFunding(rate: number | null): string {
  if (rate == null) return '—';
  const pct = rate * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(4)}%`;
}

function fmtCountdown(target: number | null): string {
  if (target == null) return '—';
  const ms = target - Date.now();
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function DerivativesModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.derivatives(symbol as string, signal),
    [symbol],
    { intervalMs: 10_000, enabled: Boolean(symbol) },
  );

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol} derivatives`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!data) return <EmptyState>No derivatives for {symbol}.</EmptyState>;

  const stats: Array<[string, string, string?]> = [
    ['Funding (8h)', fmtFunding(data.fundingRate), changeClass(data.fundingRate)],
    ['Next Funding', fmtCountdown(data.nextFundingTime)],
    ['Open Interest', data.openInterest != null ? fmtCompact(data.openInterest) : '—'],
    ['OI Notional', data.openInterestValue != null ? `$${fmtCompact(data.openInterestValue)}` : '—'],
    ['Mark', fmtPrice(data.markPrice)],
    ['Index', fmtPrice(data.indexPrice)],
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-term-border p-3">
        {stats.map(([label, value, cls]) => (
          <div key={label} className="flex items-baseline justify-between text-xs">
            <span className="text-term-muted">{label}</span>
            <span className={`tabular-nums ${cls ?? ''}`}>{value}</span>
          </div>
        ))}
      </div>
      <div className="term-label px-3 py-1">Recent liquidations</div>
      <div className="scroll-term flex-1 overflow-auto">
        {data.recentLiquidations.length === 0 ? (
          <div className="p-3 text-2xs text-term-muted">No recent liquidations.</div>
        ) : (
          <table className="w-full text-2xs">
            <tbody>
              {data.recentLiquidations.map((l, i) => {
                const isLong = l.side === 'sell';
                return (
                  <tr key={`${l.timestamp}-${i}`} className="border-b border-term-border/30">
                    <td className={`px-3 py-0.5 font-medium ${isLong ? 'text-term-down' : 'text-term-up'}`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtPrice(l.price)}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums text-term-muted">
                      ${fmtCompact(l.amount * l.price)}
                    </td>
                    <td className="px-3 py-0.5 text-right text-term-dim">{fmtTimeAgo(l.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
