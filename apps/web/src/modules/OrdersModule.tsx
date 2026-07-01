import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAccountRefresh } from '@/lib/accountBus';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { ordersBadge, type AccountTone } from '@/lib/accountReadsView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<AccountTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

const fmtAmount = (n: number): string =>
  Math.abs(n) >= 1000 ? fmtCompact(n) : n.toLocaleString(undefined, { maximumFractionDigits: 6 });

/**
 * ORD — read-only open (resting) orders on the connected exchange account.
 * Account-wide (ignores the panel symbol). Non-custodial: read with read-only
 * API keys from the server env; Midas never places or cancels orders. Honestly
 * labeled live / demo / unavailable.
 */
export function OrdersModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch((signal) => api.openOrders(signal), [], {
    intervalMs: 30_000,
  });
  useAccountRefresh(refresh);
  const badge = data ? ordersBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Open Orders</span>
        <span className="text-term-dim">read-only</span>
        {data && data.orders.length > 0 && <span className="text-term-dim">{data.orders.length}</span>}
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading orders" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.orders.length === 0 ? (
          <EmptyState>{data?.note ?? 'No open orders.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-left font-normal">SIDE</th>
                <th className="px-2 py-1 text-left font-normal">TYPE</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">AMOUNT</th>
                <th className="px-2 py-1 text-right font-normal">FILLED</th>
                <th className="px-2 py-1 text-right font-normal">VALUE</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => {
                const filledPct = o.amount > 0 ? (o.filled / o.amount) * 100 : 0;
                return (
                  <tr key={o.id} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 text-term-text">{o.symbol}</td>
                    <td className={`px-2 py-0.5 ${o.side === 'buy' ? 'text-term-up' : 'text-term-down'}`}>
                      {o.side.toUpperCase()}
                    </td>
                    <td className="px-2 py-0.5 text-term-dim">{o.type}</td>
                    <td className="px-2 py-0.5 text-right">{o.price == null ? 'mkt' : fmtPrice(o.price)}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{fmtAmount(o.amount)}</td>
                    <td className="px-2 py-0.5 text-right text-term-dim">{filledPct.toFixed(0)}%</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">
                      {o.value == null ? '—' : fmtCompact(o.value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && data.provenance !== 'unavailable' && (
        <div className="flex items-center gap-2 border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          <span
            className="ml-auto"
            title="Midas is non-custodial and read-only — it never places or cancels orders."
          >
            non-custodial · read-only
          </span>
        </div>
      )}
    </div>
  );
}
