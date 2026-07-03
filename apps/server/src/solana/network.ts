import type { SolanaNetwork } from '@midas/shared';
import { LAMPORTS_PER_SOL, jsonRpc, num, solanaEnabled, solanaSourceLabel as sourceLabel } from './rpc';

/**
 * Read-only Solana network health from public RPC — the SOLNET dashboard's
 * live source. Env-gated (MIDAS_SOLANA_RPC) and default off; any failure
 * degrades to an honest `unavailable` snapshot, never a fake `live` read. The
 * mapper is pure and defensive so it can be fixture-tested without a node.
 */

/** An honest all-null snapshot with a reason. */
function unavailable(note: string): SolanaNetwork {
  return {
    source: solanaEnabled() ? sourceLabel() : 'none',
    provenance: 'unavailable',
    note,
    slot: null,
    epoch: null,
    epochProgressPct: null,
    tps: null,
    validatorCount: null,
    totalStakeSol: null,
    circulatingSupplySol: null,
    totalSupplySol: null,
    solPriceUsd: null,
    asOf: Date.now(),
  };
}

/**
 * Map raw RPC results to a SolanaNetwork snapshot. Every input is optional so a
 * partial read (e.g. getVoteAccounts timed out) degrades a field, not the whole
 * panel. Pure — no IO — so it is the only thing unit-tested against fixtures.
 */
export function mapNetwork(inputs: {
  epochInfo: unknown;
  supply: unknown;
  perfSamples: unknown;
  voteAccounts: unknown;
  solPriceUsd: number | null;
  now: number;
}): SolanaNetwork {
  const ei = (inputs.epochInfo ?? {}) as Record<string, unknown>;
  const slot = num(ei.absoluteSlot);
  const epoch = num(ei.epoch);
  const slotIndex = num(ei.slotIndex);
  const slotsInEpoch = num(ei.slotsInEpoch);
  const epochProgressPct =
    slotIndex != null && slotsInEpoch != null && slotsInEpoch > 0
      ? (slotIndex / slotsInEpoch) * 100
      : null;

  // getSupply → { value: { total, circulating } } in lamports.
  const supplyValue = ((inputs.supply ?? {}) as Record<string, unknown>).value as
    | Record<string, unknown>
    | undefined;
  const totalLamports = num(supplyValue?.total);
  const circLamports = num(supplyValue?.circulating);

  // getRecentPerformanceSamples → [{ numTransactions, samplePeriodSecs }].
  const sample = Array.isArray(inputs.perfSamples) ? (inputs.perfSamples[0] as Record<string, unknown>) : null;
  const numTx = num(sample?.numTransactions);
  const periodSecs = num(sample?.samplePeriodSecs);
  const tps = numTx != null && periodSecs != null && periodSecs > 0 ? numTx / periodSecs : null;

  // getVoteAccounts → { current: [{ activatedStake }], delinquent: [...] }.
  const va = (inputs.voteAccounts ?? {}) as Record<string, unknown>;
  const current = Array.isArray(va.current) ? (va.current as Array<Record<string, unknown>>) : null;
  const validatorCount = current ? current.length : null;
  const totalStakeLamports = current
    ? current.reduce((sum, v) => sum + (num(v.activatedStake) ?? 0), 0)
    : null;

  return {
    source: sourceLabel(),
    provenance: 'live',
    note: null,
    slot,
    epoch,
    epochProgressPct: epochProgressPct == null ? null : Math.round(epochProgressPct * 10) / 10,
    tps: tps == null ? null : Math.round(tps),
    validatorCount,
    totalStakeSol: totalStakeLamports == null ? null : Math.round(totalStakeLamports / LAMPORTS_PER_SOL),
    circulatingSupplySol: circLamports == null ? null : Math.round(circLamports / LAMPORTS_PER_SOL),
    totalSupplySol: totalLamports == null ? null : Math.round(totalLamports / LAMPORTS_PER_SOL),
    solPriceUsd: inputs.solPriceUsd,
    asOf: inputs.now,
  };
}

/**
 * Fetch a live Solana network snapshot. Returns an honest `unavailable` when the
 * source is off or the required read fails. getEpochInfo is required; supply,
 * performance samples and vote accounts are best-effort (their failure nulls a
 * field but keeps the snapshot live).
 */
export async function fetchSolanaNetwork(solPriceUsd: number | null = null): Promise<SolanaNetwork> {
  if (!solanaEnabled()) {
    return unavailable('Live Solana data needs an RPC node — set MIDAS_SOLANA_RPC (e.g. https://api.mainnet-beta.solana.com).');
  }
  try {
    // Required — the anchor read. If this fails the whole snapshot is unavailable.
    const epochInfo = await jsonRpc('getEpochInfo', []);
    // Best-effort — each null-degrades on its own without sinking the snapshot.
    const [supply, perfSamples, voteAccounts] = await Promise.all([
      jsonRpc('getSupply', [{ commitment: 'finalized', excludeNonCirculatingAccountsList: true }]).catch(() => null),
      jsonRpc('getRecentPerformanceSamples', [1]).catch(() => null),
      jsonRpc('getVoteAccounts', []).catch(() => null),
    ]);
    return mapNetwork({ epochInfo, supply, perfSamples, voteAccounts, solPriceUsd, now: Date.now() });
  } catch (err) {
    return unavailable(`Live Solana RPC unavailable — ${err instanceof Error ? err.message : 'error'}.`);
  }
}
