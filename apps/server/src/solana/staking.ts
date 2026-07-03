import type { SolanaStaking, SolanaValidator, SolanaValidators } from '@midas/shared';
import { LAMPORTS_PER_SOL, jsonRpc, num, solanaEnabled, solanaRpcUrl } from './rpc';

/**
 * Solana staking economics — the validator leaderboard (SVAL) and native
 * staking yields (SSTAKE). Read-only: assembled from getVoteAccounts +
 * getInflationRate + getSupply RPC calls, never a transaction. Env-gated
 * (MIDAS_SOLANA_RPC), default off, degrading to an honest 'unavailable'
 * snapshot on any failure. Pure mappers are the only unit-tested pieces.
 */

const MAX_VALIDATORS = 30;
// A Solana epoch is ~2 days (432k slots × ~0.4s), so ~182 epochs/year. Used to
// compound the nominal yield into a real APY. An approximation, labeled as one.
const EPOCHS_PER_YEAR = 182;

function sourceLabel(): string {
  try {
    return `rpc:${new URL(solanaRpcUrl()).host}`;
  } catch {
    return 'rpc';
  }
}

/** Shorten a base-58 identity for display, e.g. '7Np41…Ryk9'. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 5)}…${id.slice(-4)}` : id;
}

/** A vote-account row as returned by getVoteAccounts. */
interface RawVoteAccount {
  votePubkey?: unknown;
  nodePubkey?: unknown;
  activatedStake?: unknown;
  commission?: unknown;
  lastVote?: unknown;
}

/**
 * Map getVoteAccounts → the validator leaderboard, ranked by active stake with
 * each validator's share of the total. Pure and defensive.
 */
export function mapValidators(voteAccounts: unknown, now: number): SolanaValidators {
  const va = (voteAccounts ?? {}) as { current?: unknown; delinquent?: unknown };
  const current = Array.isArray(va.current) ? (va.current as RawVoteAccount[]) : [];
  const delinquent = Array.isArray(va.delinquent) ? (va.delinquent as RawVoteAccount[]) : [];

  const totalStakeLamports =
    [...current, ...delinquent].reduce((sum, v) => sum + (num(v.activatedStake) ?? 0), 0) || 0;
  const totalStakeSol = totalStakeLamports > 0 ? totalStakeLamports / LAMPORTS_PER_SOL : null;

  const rows: SolanaValidator[] = [...current, ...delinquent].map((v) => {
    const stakeLamports = num(v.activatedStake);
    const stakeSol = stakeLamports == null ? null : stakeLamports / LAMPORTS_PER_SOL;
    return {
      votePubkey: typeof v.votePubkey === 'string' ? v.votePubkey : '',
      identity: shortId(typeof v.nodePubkey === 'string' ? v.nodePubkey : ''),
      activatedStakeSol: stakeSol == null ? null : Math.round(stakeSol),
      commissionPct: num(v.commission),
      stakeSharePct:
        stakeLamports != null && totalStakeLamports > 0
          ? Math.round((stakeLamports / totalStakeLamports) * 10000) / 100
          : null,
      delinquent: delinquent.includes(v),
      lastVoteSlot: num(v.lastVote),
    };
  });
  rows.sort((a, b) => (b.activatedStakeSol ?? 0) - (a.activatedStakeSol ?? 0));

  return {
    source: sourceLabel(),
    provenance: 'live',
    note: null,
    totalStakeSol: totalStakeSol == null ? null : Math.round(totalStakeSol),
    validatorCount: current.length,
    delinquentCount: delinquent.length,
    validators: rows.slice(0, MAX_VALIDATORS),
    asOf: now,
  };
}

/**
 * Compute native staking economics from inflation + supply + total active
 * stake. Nominal APY = inflation ÷ staked ratio; real APY compounds it across
 * the year's epochs. Pure and defensive; nullable so a partial read degrades a
 * field, not the whole panel.
 */
export function mapStaking(inputs: {
  inflation: unknown;
  supply: unknown;
  totalStakeLamports: number | null;
  now: number;
}): SolanaStaking {
  const inflationTotal = num((inputs.inflation as Record<string, unknown> | null)?.total);
  const supplyValue = ((inputs.supply ?? {}) as Record<string, unknown>).value as
    | Record<string, unknown>
    | undefined;
  const totalSupplyLamports = num(supplyValue?.total);

  const stakedRatio =
    inputs.totalStakeLamports != null && totalSupplyLamports != null && totalSupplyLamports > 0
      ? inputs.totalStakeLamports / totalSupplyLamports
      : null;
  const nominal = inflationTotal != null && stakedRatio != null && stakedRatio > 0 ? inflationTotal / stakedRatio : null;
  const real = nominal != null ? (1 + nominal / EPOCHS_PER_YEAR) ** EPOCHS_PER_YEAR - 1 : null;

  const pct = (x: number | null): number | null => (x == null ? null : Math.round(x * 1000) / 10);
  return {
    source: sourceLabel(),
    provenance: 'live',
    note: null,
    inflationPct: pct(inflationTotal),
    stakedRatioPct: pct(stakedRatio),
    nominalApyPct: pct(nominal),
    realApyPct: pct(real),
    epochsPerYear: EPOCHS_PER_YEAR,
    asOf: inputs.now,
  };
}

function validatorsUnavailable(note: string): SolanaValidators {
  return {
    source: solanaEnabled() ? sourceLabel() : 'none',
    provenance: 'unavailable',
    note,
    totalStakeSol: null,
    validatorCount: null,
    delinquentCount: null,
    validators: [],
    asOf: Date.now(),
  };
}

function stakingUnavailable(note: string): SolanaStaking {
  return {
    source: solanaEnabled() ? sourceLabel() : 'none',
    provenance: 'unavailable',
    note,
    inflationPct: null,
    stakedRatioPct: null,
    nominalApyPct: null,
    realApyPct: null,
    epochsPerYear: null,
    asOf: Date.now(),
  };
}

/** Fetch the live validator leaderboard; honest 'unavailable' when off or on failure. */
export async function fetchSolanaValidators(): Promise<SolanaValidators> {
  if (!solanaEnabled()) {
    return validatorsUnavailable('Live Solana data needs an RPC node — set MIDAS_SOLANA_RPC.');
  }
  try {
    return mapValidators(await jsonRpc('getVoteAccounts', []), Date.now());
  } catch (err) {
    return validatorsUnavailable(`Live Solana RPC unavailable — ${err instanceof Error ? err.message : 'error'}.`);
  }
}

/** Fetch live native staking economics; honest 'unavailable' when off or on failure. */
export async function fetchSolanaStaking(): Promise<SolanaStaking> {
  if (!solanaEnabled()) {
    return stakingUnavailable('Live Solana data needs an RPC node — set MIDAS_SOLANA_RPC.');
  }
  try {
    // Inflation is the anchor read; supply + vote accounts are best-effort.
    const inflation = await jsonRpc('getInflationRate', []);
    const [supply, voteAccounts] = await Promise.all([
      jsonRpc('getSupply', [{ commitment: 'finalized', excludeNonCirculatingAccountsList: true }]).catch(() => null),
      jsonRpc('getVoteAccounts', []).catch(() => null),
    ]);
    const va = (voteAccounts ?? {}) as { current?: unknown; delinquent?: unknown };
    const all = [
      ...(Array.isArray(va.current) ? (va.current as RawVoteAccount[]) : []),
      ...(Array.isArray(va.delinquent) ? (va.delinquent as RawVoteAccount[]) : []),
    ];
    const totalStakeLamports = all.length
      ? all.reduce((sum, v) => sum + (num(v.activatedStake) ?? 0), 0)
      : null;
    return mapStaking({ inflation, supply, totalStakeLamports, now: Date.now() });
  } catch (err) {
    return stakingUnavailable(`Live Solana RPC unavailable — ${err instanceof Error ? err.message : 'error'}.`);
  }
}
