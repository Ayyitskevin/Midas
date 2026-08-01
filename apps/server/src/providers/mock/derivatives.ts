import type {
  DerivativesInfo,
  DexPool,
  DexPools,
  LiquidationsProvenance,
  VenueDerivatives,
} from '@midas/shared';
import { gaussian, round, seeded, uniform } from '../util';
import { COMPARE_VENUES, DEX_VENUES, resolveEntry } from './fixtures';
import { buildQuote } from './quote';

/**
 * Deterministic per-symbol funding cadence (hours). Mostly the common 8h, with
 * one hourly and one 4h symbol so the funding boards exercise interval
 * normalization and labeling. Synthetic, like every mock value.
 */
const FUNDING_INTERVAL_HOURS: Record<string, number> = {
  'SOL/USDT': 1, // hourly-funding venue (Hyperliquid-style)
  'DOGE/USDT': 4, // 4h cadence (several Binance perps)
};

function fundingIntervalFor(symbol: string): number {
  return FUNDING_INTERVAL_HOURS[symbol] ?? 8;
}

/** Next settlement boundary for an `intervalHours` cadence, epoch millis. */
function nextFundingBoundary(intervalHours: number): number {
  const stepMs = intervalHours * 3_600_000;
  return (Math.floor(Date.now() / stepMs) + 1) * stepMs;
}

export async function mockVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
  const intervalHours = fundingIntervalFor(entry.symbol);
  const eightHour = Math.floor(Date.now() / (8 * 3_600_000));
  const nextFunding = nextFundingBoundary(intervalHours);
  return COMPARE_VENUES.map((venue) => {
    // Each venue funds slightly differently → a realistic cross-venue spread.
    const rng = seeded(entry.symbol, venue, eightHour, 'venuederiv');
    const oiBase = Math.floor(uniform(rng, 1_000, 250_000) * (mid > 1000 ? 1 : 1000));
    return {
      exchange: venue,
      fundingRate: round(gaussian(rng) * 0.0001, 6),
      fundingIntervalHours: intervalHours,
      nextFundingTime: nextFunding,
      markPrice: round(mid * (1 + gaussian(rng) * 0.0003), 6),
      openInterestValue: Math.floor(oiBase * mid),
      timestamp: Date.now(),
    };
  });
}

export async function mockDerivatives(symbol: string): Promise<DerivativesInfo> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
  const intervalHours = fundingIntervalFor(entry.symbol);
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const rng = seeded(entry.symbol, hourBucket, 'deriv');
  const oiBase = Math.floor(uniform(rng, 1_000, 250_000) * (mid > 1000 ? 1 : 1000));
  // Next funding at the next settlement boundary for this symbol's cadence.
  const nextFunding = nextFundingBoundary(intervalHours);

  const minuteBucket = Math.floor(Date.now() / 60_000);
  const lrng = seeded(entry.symbol, minuteBucket, 'liq');
  const recentLiquidations = Array.from({ length: 12 }, (_, i) => {
    const side = lrng() > 0.5 ? ('buy' as const) : ('sell' as const);
    const price = round(mid * (1 + (side === 'buy' ? 1 : -1) * uniform(lrng, 0, 0.012)), 6);
    return {
      side,
      price,
      amount: round(uniform(lrng, 0.05, 8) * (mid > 1000 ? 1 : 1000), 4),
      timestamp: Date.now() - Math.floor(i * uniform(lrng, 4_000, 30_000)),
    };
  });

  return {
    symbol: entry.symbol.includes(':') ? entry.symbol : `${entry.symbol}:${entry.currency}`,
    fundingRate: round(gaussian(rng) * 0.0001, 6),
    fundingIntervalHours: intervalHours,
    nextFundingTime: nextFunding,
    markPrice: round(mid * (1 + gaussian(rng) * 0.0003), 6),
    indexPrice: mid,
    openInterest: oiBase,
    openInterestValue: Math.floor(oiBase * mid),
    recentLiquidations,
    timestamp: Date.now(),
  };
}

export function mockLiquidationsProvenance(): LiquidationsProvenance {
  return {
    source: 'mock',
    available: true,
    synthetic: true, // fabricated events — the panel shows 'demo', never a green 'live'
    note: 'Synthetic liquidations for offline/demo use — not real market data.',
  };
}

export async function mockDexPools(symbol: string): Promise<DexPools> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
  const base = entry.symbol.split('/')[0].replace(/:.*$/, '');
  const day = Math.floor(Date.now() / 86_400_000);
  const pools: DexPool[] = DEX_VENUES.map(({ dex, feeBps, quote }) => {
    // Each pool prices slightly off mid and carries its own TVL/volume.
    const rng = seeded(entry.symbol, dex, feeBps, day, 'dex');
    const liquidityUsd = Math.floor(uniform(rng, 0.5, 40) * 1_000_000);
    return {
      dex,
      pair: `${base}/${quote}`,
      priceUsd: round(mid * (1 + gaussian(rng) * 0.002), 6),
      liquidityUsd,
      volume24hUsd: Math.floor(uniform(rng, 0.1, 3) * liquidityUsd),
      feeBps,
    };
  });
  return {
    symbol: base,
    provenance: 'synthetic',
    note: 'Synthetic DEX pools for offline/demo use — not real on-chain data.',
    pools,
  };
}
