import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtInt } from '@/lib/format';
import { solanaBadge, type SolanaTone } from '@/lib/solanaView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<SolanaTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

/**
 * SVAL — the Solana validator leaderboard, ranked by active stake: identity,
 * stake, share of network, commission and voting status. Read-only
 * (getVoteAccounts RPC), non-custodial; honest live/synthetic/unavailable badge.
 */
export function SolanaValidatorsModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaValidators(signal),
    [],
    { intervalMs: 30_000 },
  );
  const badge = data ? solanaBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Solana</span>
        <span className="text-term-dim">validators · by stake</span>
        {data?.validatorCount != null && (
          <span className="text-term-muted">
            {fmtInt(data.validatorCount)} active
            {data.delinquentCount ? <span className="text-term-down"> · {fmtInt(data.delinquentCount)} delinquent</span> : null}
          </span>
        )}
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading validators" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.validators.length === 0 ? (
          <EmptyState>{data?.note ?? 'No validators available.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">#</th>
                <th className="px-2 py-1 text-left font-normal">IDENTITY</th>
                <th className="px-2 py-1 text-right font-normal">STAKE</th>
                <th className="px-2 py-1 text-right font-normal">SHARE</th>
                <th className="px-2 py-1 text-right font-normal">COMM</th>
                <th className="px-2 py-1 text-left font-normal">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {data.validators.map((v, i) => (
                <tr key={v.votePubkey || i} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-term-dim">{i + 1}</td>
                  <td className="px-2 py-0.5 font-mono text-term-text" title={v.votePubkey}>
                    {v.identity}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {v.activatedStakeSol == null ? '—' : `${fmtCompact(v.activatedStakeSol)} SOL`}
                  </td>
                  <td className="px-2 py-0.5 text-right">{v.stakeSharePct == null ? '—' : `${v.stakeSharePct.toFixed(2)}%`}</td>
                  <td className="px-2 py-0.5 text-right text-term-dim">{v.commissionPct == null ? '—' : `${v.commissionPct}%`}</td>
                  <td className={`px-2 py-0.5 ${v.delinquent ? 'text-term-down' : 'text-term-up'}`}>
                    {v.delinquent ? 'delinquent' : 'voting'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.totalStakeSol != null && (
        <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          Total stake <span className="text-term-text">{fmtCompact(data.totalStakeSol)} SOL</span> · top{' '}
          {data.validators.length} shown · read-only
        </div>
      )}
    </div>
  );
}
