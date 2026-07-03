import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtInt, fmtPrice } from '@/lib/format';
import { solanaBadge, type SolanaTone } from '@/lib/solanaView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<SolanaTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

/** One label/value stat cell. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1.5" title={hint}>
      <span className="text-2xs uppercase tracking-wide text-term-muted">{label}</span>
      <span className="text-sm tabular-nums text-term-text">{value}</span>
    </div>
  );
}

/**
 * Solana network dashboard (SOLNET) — read-only network health from the Solana
 * data dimension: slot, epoch progress, TPS, validators, stake and SOL supply.
 * Non-custodial (public RPC reads only). Honest badge: live / synthetic / off.
 */
export function SolanaNetworkModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaNetwork(signal),
    [],
    { intervalMs: 15_000 },
  );
  const badge = data ? solanaBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">SOL</span>
        <span className="text-term-dim">Solana network</span>
        {data?.solPriceUsd != null && (
          <span className="text-term-muted">
            SOL <span className="text-term-text tabular-nums">{fmtPrice(data.solPriceUsd)}</span>
          </span>
        )}
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto p-2">
        {loading && !data ? (
          <Loading label="Loading network" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.provenance === 'unavailable' ? (
          <EmptyState>{data?.note ?? 'Solana network data unavailable.'}</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Slot" value={data.slot == null ? '—' : fmtInt(data.slot)} hint="Current absolute slot" />
            <Stat label="Epoch" value={data.epoch == null ? '—' : fmtInt(data.epoch)} />
            <Stat
              label="Epoch %"
              value={data.epochProgressPct == null ? '—' : `${data.epochProgressPct.toFixed(1)}%`}
              hint="Progress through the current epoch"
            />
            <Stat label="TPS" value={data.tps == null ? '—' : fmtInt(data.tps)} hint="Recent transactions per second" />
            <Stat
              label="Validators"
              value={data.validatorCount == null ? '—' : fmtInt(data.validatorCount)}
              hint="Current-epoch active validators"
            />
            <Stat
              label="Active stake"
              value={data.totalStakeSol == null ? '—' : `${fmtCompact(data.totalStakeSol)} SOL`}
            />
            <Stat
              label="Circulating"
              value={data.circulatingSupplySol == null ? '—' : `${fmtCompact(data.circulatingSupplySol)} SOL`}
            />
            <Stat
              label="Total supply"
              value={data.totalSupplySol == null ? '—' : `${fmtCompact(data.totalSupplySol)} SOL`}
            />
            <Stat
              label="Mkt cap"
              value={
                data.circulatingSupplySol != null && data.solPriceUsd != null
                  ? `$${fmtCompact(data.circulatingSupplySol * data.solPriceUsd)}`
                  : '—'
              }
              hint="Circulating supply × SOL price"
            />
          </div>
        )}
      </div>

      {data && (
        <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          {data.source} · read-only · non-custodial
        </div>
      )}
    </div>
  );
}
