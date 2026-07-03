import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { solanaBadge, SOLANA_TONE_CLASS } from '@/lib/solanaView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

function Stat({ label, value, hint, emphasis }: { label: string; value: string; hint?: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1.5" title={hint}>
      <span className="text-2xs uppercase tracking-wide text-term-muted">{label}</span>
      <span className={`tabular-nums ${emphasis ? 'text-base text-term-up' : 'text-sm text-term-text'}`}>{value}</span>
    </div>
  );
}

const pct = (x: number | null): string => (x == null ? '—' : `${x.toFixed(1)}%`);

/**
 * SSTAKE — Solana native staking economics: nominal & real (epoch-compounded)
 * APY, network inflation and the staked ratio, derived from RPC
 * (getInflationRate + getSupply + getVoteAccounts). Read-only, non-custodial;
 * honest live/synthetic/unavailable badge.
 */
export function SolanaStakingModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaStaking(signal),
    [],
    { intervalMs: 60_000 },
  );
  const badge = data ? solanaBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">SOL</span>
        <span className="text-term-dim">native staking</span>
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${SOLANA_TONE_CLASS[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto p-2">
        {loading && !data ? (
          <Loading label="Loading staking" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.provenance === 'unavailable' ? (
          <EmptyState>{data?.note ?? 'Solana staking data unavailable.'}</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Real APY" value={pct(data.realApyPct)} hint="Nominal yield compounded across the year's epochs" emphasis />
            <Stat label="Nominal APY" value={pct(data.nominalApyPct)} hint="Inflation ÷ staked ratio (before commission)" />
            <Stat label="Inflation" value={pct(data.inflationPct)} hint="Current total network inflation" />
            <Stat label="Staked ratio" value={pct(data.stakedRatioPct)} hint="Share of SOL supply that is actively staked" />
          </div>
        )}
      </div>

      {data && data.provenance !== 'unavailable' && (
        <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          {data.epochsPerYear ? `≈ ${data.epochsPerYear} epochs/yr` : ''} · yields are before validator commission ·
          read-only
        </div>
      )}
    </div>
  );
}
