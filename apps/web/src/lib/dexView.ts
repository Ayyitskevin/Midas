import type { DexPool, DexPools } from '@midas/shared';

/**
 * Pure view helpers for the on-chain / DEX module: an honesty badge derived from
 * the snapshot's provenance, and a roll-up of the pool set (TVL, 24h volume,
 * liquidity-weighted price and cross-pool price dispersion). No real on-chain
 * source is wired yet — the badge is what keeps the UI honest about that.
 */
export type DexTone = 'live' | 'synthetic' | 'unavailable';

export interface DexBadge {
  label: string;
  tone: DexTone;
  detail: string;
}

export function dexBadge(p: DexPools): DexBadge {
  switch (p.provenance) {
    case 'live':
      return { label: 'on-chain', tone: 'live', detail: p.note ?? 'Live on-chain data.' };
    case 'synthetic':
      return { label: 'synthetic', tone: 'synthetic', detail: p.note ?? 'Synthetic — not real on-chain data.' };
    default:
      return { label: 'unavailable', tone: 'unavailable', detail: p.note ?? 'On-chain data unavailable.' };
  }
}

export interface DexSummary {
  poolCount: number;
  totalLiquidityUsd: number;
  totalVolume24hUsd: number;
  /** Liquidity-weighted average price (falls back to a simple mean if no liquidity), or null. */
  vwapUsd: number | null;
  /** (max − min) pool price as a percent of the average, or null when < 1 priced pool. */
  priceSpreadPct: number | null;
}

export function summarizeDexPools(pools: DexPool[]): DexSummary {
  let totalLiquidityUsd = 0;
  let totalVolume24hUsd = 0;
  let weightedSum = 0; // Σ price·liquidity
  let weightBase = 0; // Σ liquidity over priced pools
  let priceSum = 0;
  let pricedCount = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const p of pools) {
    if (p.liquidityUsd != null) totalLiquidityUsd += p.liquidityUsd;
    if (p.volume24hUsd != null) totalVolume24hUsd += p.volume24hUsd;
    if (p.priceUsd != null) {
      pricedCount += 1;
      priceSum += p.priceUsd;
      const w = p.liquidityUsd ?? 0;
      weightedSum += p.priceUsd * w;
      weightBase += w;
      if (p.priceUsd < min) min = p.priceUsd;
      if (p.priceUsd > max) max = p.priceUsd;
    }
  }

  const vwapUsd = weightBase > 0 ? weightedSum / weightBase : pricedCount > 0 ? priceSum / pricedCount : null;
  const priceSpreadPct = vwapUsd != null && pricedCount > 0 ? ((max - min) / vwapUsd) * 100 : null;

  return { poolCount: pools.length, totalLiquidityUsd, totalVolume24hUsd, vwapUsd, priceSpreadPct };
}

export interface CexDexCompare {
  cexMid: number | null;
  dexVwap: number | null;
  /** DEX premium (+) / discount (−) vs the CEX mid, in percent; null if either side is missing. */
  basisPct: number | null;
}

/** Basis of the DEX VWAP against the centralized-exchange mid — the arb the two markets imply. */
export function cexDexBasis(cexMid: number | null, dexVwap: number | null): CexDexCompare {
  const basisPct =
    cexMid != null && cexMid !== 0 && dexVwap != null ? ((dexVwap - cexMid) / cexMid) * 100 : null;
  return { cexMid, dexVwap, basisPct };
}

/**
 * Rough constant-product (x·y=k) price impact of a USD-sized swap against a pool.
 * Approximates a balanced pool as USD reserve R = liquidityUsd / 2 on the side
 * being depleted; impact = T / (R − T). Returns null when the size can't be
 * priced (no/zero liquidity, non-positive size) or meets/exceeds the reserve
 * (the pool can't absorb it). An estimate from TVL alone — not a routed quote.
 */
export function estimatePriceImpactPct(liquidityUsd: number | null, tradeSizeUsd: number): number | null {
  if (liquidityUsd == null || liquidityUsd <= 0 || tradeSizeUsd <= 0) return null;
  const reserve = liquidityUsd / 2;
  if (tradeSizeUsd >= reserve) return null;
  return (tradeSizeUsd / (reserve - tradeSizeUsd)) * 100;
}
