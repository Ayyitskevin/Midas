import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAccountRefresh, emitAccountChange } from '@/lib/accountBus';
import { useTradingStatus } from '@/lib/useTradingStatus';
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

/** Compact order age, e.g. 42s / 18m / 6h / 3d. */
function fmtAge(ts: number | null): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * ORD — read-only open (resting) orders on the connected exchange account.
 * Account-wide (ignores the panel symbol). The execution safety hold keeps this
 * panel read-only; existing orders must be managed directly at the exchange.
 */
export function OrdersModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch((signal) => api.openOrders(signal), [], {
    intervalMs: 30_000,
  });
  useAccountRefresh(refresh);
  const trading = useTradingStatus();
  const canCancel = trading?.enabled ?? false;

  // Two-step cancel: first click arms the row, second confirms.
  const [armedId, setArmedId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function doCancel(id: string, symbol: string) {
    setCancelingId(id);
    setCancelError(null);
    try {
      await api.cancelOrder(id, symbol);
      setArmedId(null);
      emitAccountChange(); // this panel + BAL/POSN refresh
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Cancel failed.');
    } finally {
      setCancelingId(null);
    }
  }

  const badge = data ? ordersBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Open Orders</span>
        <span className="text-term-dim">{canCancel ? 'read + cancel' : 'read-only'}</span>
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
                <th className="px-2 py-1 text-right font-normal" title="Time since the order was placed">
                  AGE
                </th>
                {canCancel && <th className="px-2 py-1 text-right font-normal">CXL</th>}
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => {
                const filledPct = o.amount > 0 ? (o.filled / o.amount) * 100 : 0;
                const armed = armedId === o.id;
                const busy = cancelingId === o.id;
                return (
                  <tr key={o.id} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 text-term-text">{o.symbol}{o.venue && <span className="ml-1 text-term-dim" title={`venue: ${o.venue}`}>·{o.venue}</span>}</td>
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
                    <td className="px-2 py-0.5 text-right text-term-dim">{fmtAge(o.timestamp)}</td>
                    {canCancel && (
                      <td className="px-2 py-0.5 text-right">
                        {armed ? (
                          <span className="inline-flex gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => doCancel(o.id, o.symbol)}
                              className="rounded-sm border border-term-down/60 bg-term-down/20 px-1.5 text-term-down hover:bg-term-down/30 disabled:opacity-50"
                              title={`Confirm: cancel this ${o.symbol} order on the exchange`}
                            >
                              {busy ? '…' : 'confirm'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setArmedId(null)}
                              className="rounded-sm border border-term-border px-1.5 text-term-muted hover:text-term-text disabled:opacity-50"
                            >
                              keep
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setArmedId(o.id);
                              setCancelError(null);
                            }}
                            className="rounded-sm border border-term-border px-1.5 text-term-dim hover:border-term-down/50 hover:text-term-down"
                            title="Cancel this order (two-step confirm)"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {cancelError && (
        <div className="border-t border-term-down/40 bg-term-down/10 px-2 py-1 text-2xs text-term-down">
          ⚠ {cancelError}
        </div>
      )}

      {data && data.provenance !== 'unavailable' && (
        <div className="flex items-center gap-2 border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          <span
            className="ml-auto"
            title={
              canCancel
                ? 'Live trading is enabled — cancels execute on the exchange after a two-step confirm.'
                : trading?.reason ?? 'Midas is non-custodial and read-only.'
            }
          >
            {canCancel ? 'non-custodial · cancel enabled' : 'non-custodial · read-only'}
          </span>
        </div>
      )}
    </div>
  );
}
