import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact } from '@/lib/format';
import { equityStats, polylinePoints } from '@/lib/equityView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';

const W = 600;
const H = 160;

/**
 * AEQ — the real account's equity curve, from server-side snapshots (the
 * journal EQ board's idea, applied to the live account). Honest by design:
 * points only exist where the account was actually readable — outages render
 * as gaps in time, never interpolated values.
 */
export function AccountEquityModule() {
  const { data, error, loading, refresh } = useFetch((signal) => api.accountEquity(signal), [], {
    intervalMs: 60_000,
  });

  if (loading && !data) return <Loading label="Loading equity" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!data) return null;

  const stats = equityStats(data.points);
  const up = stats != null && stats.last >= stats.first;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Account equity</span>
        {stats && (
          <>
            <span className="font-mono text-term-text">${fmtCompact(stats.last)}</span>
            {stats.changePct != null && (
              <span className={`font-mono ${up ? 'text-term-up' : 'text-term-down'}`}>
                {stats.changePct >= 0 ? '+' : ''}
                {stats.changePct.toFixed(2)}%
              </span>
            )}
          </>
        )}
        <span
          className={`ml-auto rounded-sm border px-1.5 py-0.5 ${
            data.watching ? 'border-term-up/50 text-term-up' : 'border-term-border text-term-dim'
          }`}
          title={data.note ?? 'Snapshots are accruing on the server.'}
        >
          {data.watching ? 'SNAPSHOTTING' : 'OFF'}
        </span>
      </div>

      <div className="min-h-0 flex-1 p-2">
        {data.points.length < 2 ? (
          <EmptyState>
            {data.note ??
              `Only ${data.points.length} snapshot${data.points.length === 1 ? '' : 's'} so far — the curve draws once two exist. Snapshots accrue on the server (default hourly), browser open or not.`}
          </EmptyState>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
            <polyline
              points={polylinePoints(data.points, W, H)}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className={up ? 'stroke-term-up' : 'stroke-term-down'}
              strokeWidth="1.5"
            />
          </svg>
        )}
      </div>

      {stats && data.points.length >= 2 && (
        <div className="flex items-center gap-3 border-t border-term-border px-2 py-1 font-mono text-2xs text-term-dim">
          <span>min ${fmtCompact(stats.min)}</span>
          <span>max ${fmtCompact(stats.max)}</span>
          <span>{data.points.length} snapshots</span>
          <span className="ml-auto" title="Midas reads balances/positions — it never moves funds.">
            non-custodial · read-only
          </span>
        </div>
      )}
    </div>
  );
}
