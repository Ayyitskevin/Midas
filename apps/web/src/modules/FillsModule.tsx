import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAccountRefresh } from '@/lib/accountBus';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { fillsBadge, type AccountTone } from '@/lib/accountReadsView';
import { fillSlippageBps, fmtBps } from '@/lib/postTradeSlippage';
import { useFillBaselines } from '@/store/useFillBaselines';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<AccountTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

const fmtAmount = (n: number): string =>
  Math.abs(n) >= 1000 ? fmtCompact(n) : n.toLocaleString(undefined, { maximumFractionDigits: 6 });

function fmtTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = Date.now();
  const time = d.toLocaleTimeString(undefined, { hour12: false });
  // Same UTC day → time only; otherwise prefix a short date.
  return now - ts < 86_400_000 && d.getDate() === new Date(now).getDate()
    ? time
    : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

/**
 * FILLS — read-only recent executions (my-trades) on the connected account:
 * the trader's own tape. Symbol-aware because several exchanges (e.g. Binance)
 * only serve fills per symbol; opened bare it shows account-wide fills where
 * the venue supports it, or an honest note telling you to narrow by symbol.
 */
export function FillsModule({ panel }: ModuleProps) {
  const symbol = panel.symbol ?? undefined;

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.fills(symbol, signal),
    [symbol],
    { intervalMs: 30_000 },
  );
  useAccountRefresh(refresh);

  const badge = data ? fillsBadge(data) : null;
  // Placement-time estimates recorded by TICKET in this browser — the join
  // key is the fill's orderId. Fills placed elsewhere have no baseline.
  const baselines = useFillBaselines((s) => s.baselines);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Fills</span>
        <span className="text-term-dim">{symbol ?? 'all symbols'}</span>
        {data && data.fills.length > 0 && <span className="text-term-dim">{data.fills.length}</span>}
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading fills" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.fills.length === 0 ? (
          <EmptyState>{data?.note ?? 'No recent fills.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">TIME</th>
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-left font-normal">SIDE</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">AMOUNT</th>
                <th className="px-2 py-1 text-right font-normal">COST</th>
                <th className="px-2 py-1 text-right font-normal">FEE</th>
                <th
                  className="px-2 py-1 text-right font-normal"
                  title="Realized vs the TICKET preview's estimated fill (recorded in this browser at placement). + = worse than estimated."
                >
                  SLIP
                </th>
                <th className="px-2 py-1 text-right font-normal" title="maker / taker">
                  M/T
                </th>
              </tr>
            </thead>
            <tbody>
              {data.fills.map((f) => {
                const slip = fillSlippageBps(f, baselines);
                return (
                  <tr key={f.id} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 text-term-dim">{fmtTime(f.timestamp)}</td>
                    <td className="px-2 py-0.5 text-term-text">{f.symbol}</td>
                    <td className={`px-2 py-0.5 ${f.side === 'buy' ? 'text-term-up' : 'text-term-down'}`}>
                      {f.side.toUpperCase()}
                    </td>
                    <td className="px-2 py-0.5 text-right">{fmtPrice(f.price)}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{fmtAmount(f.amount)}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{fmtCompact(f.cost)}</td>
                    <td className="px-2 py-0.5 text-right text-term-dim">
                      {f.fee == null ? '—' : `${f.fee.toLocaleString(undefined, { maximumFractionDigits: 6 })}${f.feeCurrency ? ` ${f.feeCurrency}` : ''}`}
                    </td>
                    <td
                      className={`px-2 py-0.5 text-right ${
                        slip == null ? 'text-term-dim' : slip > 0 ? 'text-term-down' : 'text-term-up'
                      }`}
                    >
                      {slip == null ? '—' : fmtBps(slip)}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-dim">
                      {f.takerOrMaker ? f.takerOrMaker[0].toUpperCase() : '—'}
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
          <span className="ml-auto" title="Midas reads your fills — it never moves funds.">
            non-custodial · read-only
          </span>
        </div>
      )}
    </div>
  );
}
