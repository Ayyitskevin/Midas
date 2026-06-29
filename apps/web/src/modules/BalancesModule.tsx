import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact } from '@/lib/format';
import { allocations, balancesBadge, type BalancesTone } from '@/lib/balancesView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<BalancesTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

// Keep small token balances readable, abbreviate large ones.
function fmtAmount(n: number): string {
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return fmtCompact(n);
  if (abs >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

/**
 * BAL — read-only account balances. Account-wide (no symbol), so it ignores the
 * panel's symbol. Non-custodial: balances are read with read-only API keys that
 * live only in the operator's server env; the terminal never places orders or
 * moves funds. Honestly labeled live / demo / unavailable via the badge.
 */
export function BalancesModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch((signal) => api.balances(signal), [], {
    intervalMs: 30_000,
  });

  const badge = data ? balancesBadge(data) : null;
  const allocByAsset = useMemo(() => {
    const m = new Map<string, number>();
    if (data) for (const a of allocations(data)) m.set(a.asset, a.pct);
    return m;
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Balances</span>
        <span className="text-term-dim">read-only</span>
        {data?.totalValueUsd != null && (
          <span className="text-term-dim">
            total <span className="text-term-text">${fmtCompact(data.totalValueUsd)}</span>
          </span>
        )}
        {badge && (
          <span
            className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`}
            title={badge.detail}
          >
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading balances" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.balances.length === 0 ? (
          <EmptyState>{data?.note ?? 'No balances to show.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">ASSET</th>
                <th className="px-2 py-1 text-right font-normal">FREE</th>
                <th className="px-2 py-1 text-right font-normal">USED</th>
                <th className="px-2 py-1 text-right font-normal">TOTAL</th>
                <th className="px-2 py-1 text-right font-normal">VALUE</th>
                <th className="px-2 py-1 text-right font-normal" title="Share of total priced value">
                  ALLOC
                </th>
              </tr>
            </thead>
            <tbody>
              {data.balances.map((b) => {
                const pct = allocByAsset.get(b.asset);
                return (
                  <tr key={b.asset} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 font-semibold text-term-text">{b.asset}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">{fmtAmount(b.free)}</td>
                    <td className="px-2 py-0.5 text-right text-term-dim">
                      {b.used > 0 ? fmtAmount(b.used) : '—'}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-text">{fmtAmount(b.total)}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">
                      {b.valueUsd == null ? '—' : `$${fmtCompact(b.valueUsd)}`}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-dim">
                      {pct == null ? '—' : `${pct.toFixed(1)}%`}
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
          <span>{data.balances.length} assets</span>
          <span
            className="ml-auto"
            title="Midas is non-custodial and read-only — it never places orders or moves funds."
          >
            non-custodial · read-only
          </span>
        </div>
      )}
    </div>
  );
}
