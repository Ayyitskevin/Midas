import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAccountRefresh } from '@/lib/accountBus';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { positionsBadge, type AccountTone } from '@/lib/accountReadsView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import { SourceBadge } from '@/components/SourceInspector';
import { isReceiptActionable } from '@/lib/receiptView';
import type { ModuleProps } from './types';

const TONE: Record<AccountTone, string> = {
  live: 'border-term-border text-term-muted',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

const pnlClass = (n: number | null, actionable: boolean) =>
  !actionable || n == null ? 'text-term-dim' : n >= 0 ? 'text-term-up' : 'text-term-down';
const fmtUsd = (n: number | null) => (n == null ? '—' : `${n < 0 ? '-' : ''}$${fmtCompact(Math.abs(n))}`);
const fmtSize = (n: number) =>
  Math.abs(n) >= 1000 ? fmtCompact(n) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
// 'BTC/USDT:USDT' → 'BTC/USDT' for display.
const displaySymbol = (s: string) => s.replace(/:.*$/, '');

/**
 * POSN — read-only open derivatives positions on the connected exchange account.
 * Account-wide (ignores the panel symbol). Non-custodial: read with read-only
 * API keys from the server env; Midas never opens or closes positions. Honestly
 * labeled live / demo / unavailable.
 */
export function PositionsModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch((signal) => api.positions(signal), [], {
    intervalMs: 30_000,
  });
  useAccountRefresh(refresh);
  const badge = data ? positionsBadge(data) : null;
  const actionable = isReceiptActionable(data?.receipt);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Positions</span>
        <span className="text-term-dim">read-only</span>
        {data?.totalUnrealizedPnlUsd != null && (
          <span className="text-term-dim">
            uPnL <span className={pnlClass(data.totalUnrealizedPnlUsd, actionable)}>{fmtUsd(data.totalUnrealizedPnlUsd)}</span>
          </span>
        )}
        {data?.receipt ? (
          <SourceBadge receipt={data.receipt} compact className="ml-auto" />
        ) : badge ? (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.tone === 'live' ? `${badge.detail} Freshness unknown: no receipt.` : badge.detail}>
            {badge.label}{badge.tone === 'live' ? ' · freshness unknown' : ''}
          </span>
        ) : null}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading positions" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.positions.length === 0 ? (
          <EmptyState>{data?.note ?? 'No open positions.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-left font-normal">SIDE</th>
                <th className="px-2 py-1 text-right font-normal">SIZE</th>
                <th className="px-2 py-1 text-right font-normal">ENTRY</th>
                <th className="px-2 py-1 text-right font-normal">MARK</th>
                <th className="px-2 py-1 text-right font-normal">uPNL</th>
                <th className="px-2 py-1 text-right font-normal">uPNL%</th>
                <th className="px-2 py-1 text-right font-normal">LIQ</th>
                <th className="px-2 py-1 text-right font-normal">LEV</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p, i) => (
                <tr key={`${p.symbol}-${i}`} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-term-text">{displaySymbol(p.symbol)}{p.venue && <span className="ml-1 text-term-dim" title={`venue: ${p.venue}`}>·{p.venue}</span>}</td>
                  <td className={`px-2 py-0.5 ${actionable ? (p.side === 'long' ? 'text-term-up' : 'text-term-down') : 'text-term-muted'}`}>
                    {p.side.toUpperCase()}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{fmtSize(p.contracts)}</td>
                  <td className="px-2 py-0.5 text-right">{p.entryPrice == null ? '—' : fmtPrice(p.entryPrice)}</td>
                  <td className="px-2 py-0.5 text-right">{p.markPrice == null ? '—' : fmtPrice(p.markPrice)}</td>
                  <td className={`px-2 py-0.5 text-right ${pnlClass(p.unrealizedPnlUsd, actionable)}`}>{fmtUsd(p.unrealizedPnlUsd)}</td>
                  <td className={`px-2 py-0.5 text-right ${pnlClass(p.pnlPct, actionable)}`}>
                    {p.pnlPct == null ? '—' : `${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%`}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${actionable ? 'text-term-down/80' : 'text-term-muted'}`}>
                    {p.liquidationPrice == null ? '—' : fmtPrice(p.liquidationPrice)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-dim">{p.leverage == null ? '—' : `${p.leverage}×`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.provenance !== 'unavailable' && (
        <div className="flex items-center gap-2 border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          <span>{data.positions.length} positions</span>
          <span
            className="ml-auto"
            title="Midas is non-custodial and read-only — it never opens or closes positions."
          >
            non-custodial · read-only
          </span>
        </div>
      )}
    </div>
  );
}
