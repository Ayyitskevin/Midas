import type { CoinRef, CoinUniverse } from '@midas/shared';
import { clamp, gaussian, seeded } from '../util';
import { MOCK_SOURCE } from './fixtures';

/**
 * A curated reference universe for the synthetic "top coins by market cap" board
 * (the TOP panel). Exchanges expose price and volume but not circulating supply,
 * so there is no honest market cap from a CEX feed alone — this fixture supplies
 * approximate supplies and a reference price so a synthetic-but-realistic ranking
 * exists offline. Figures are ORDER-OF-MAGNITUDE approximations, not live data;
 * the universe is always labeled `provenance: 'synthetic'`. A live source
 * (env-gated, e.g. CoinGecko) replaces these with real figures.
 */
interface CoinSeed {
  base: string;
  name: string;
  category: string;
  /** Reference price in USD the synthetic quote wiggles around. */
  price: number;
  /** Approximate circulating supply, in whole base-asset units. */
  circulating: number;
  /** Approximate total / max supply; null when uncapped. */
  total: number | null;
}

export const COIN_UNIVERSE: CoinSeed[] = [
  { base: 'BTC', name: 'Bitcoin', category: 'L1', price: 67_400, circulating: 19_800_000, total: 21_000_000 },
  { base: 'ETH', name: 'Ethereum', category: 'L1', price: 3_500, circulating: 120_400_000, total: null },
  { base: 'BNB', name: 'BNB', category: 'Exchange', price: 600, circulating: 146_000_000, total: 146_000_000 },
  { base: 'SOL', name: 'Solana', category: 'L1', price: 150, circulating: 470_000_000, total: null },
  { base: 'XRP', name: 'XRP', category: 'Payments', price: 0.52, circulating: 57_000_000_000, total: 100_000_000_000 },
  { base: 'DOGE', name: 'Dogecoin', category: 'Meme', price: 0.12, circulating: 146_000_000_000, total: null },
  { base: 'ADA', name: 'Cardano', category: 'L1', price: 0.38, circulating: 35_000_000_000, total: 45_000_000_000 },
  { base: 'TON', name: 'Toncoin', category: 'L1', price: 5.2, circulating: 2_500_000_000, total: null },
  { base: 'AVAX', name: 'Avalanche', category: 'L1', price: 27, circulating: 400_000_000, total: 720_000_000 },
  { base: 'LINK', name: 'Chainlink', category: 'Oracle', price: 14, circulating: 620_000_000, total: 1_000_000_000 },
  { base: 'DOT', name: 'Polkadot', category: 'L1', price: 6.2, circulating: 1_450_000_000, total: null },
  { base: 'MATIC', name: 'Polygon', category: 'L2', price: 0.55, circulating: 9_300_000_000, total: 10_000_000_000 },
  { base: 'NEAR', name: 'NEAR Protocol', category: 'L1', price: 5.5, circulating: 1_100_000_000, total: null },
  { base: 'LTC', name: 'Litecoin', category: 'Payments', price: 72, circulating: 75_000_000, total: 84_000_000 },
  { base: 'BCH', name: 'Bitcoin Cash', category: 'Payments', price: 400, circulating: 19_800_000, total: 21_000_000 },
  { base: 'UNI', name: 'Uniswap', category: 'DeFi', price: 9.1, circulating: 600_000_000, total: 1_000_000_000 },
  { base: 'ATOM', name: 'Cosmos', category: 'L1', price: 7.5, circulating: 390_000_000, total: null },
  { base: 'APT', name: 'Aptos', category: 'L1', price: 8.5, circulating: 480_000_000, total: null },
  { base: 'ARB', name: 'Arbitrum', category: 'L2', price: 0.9, circulating: 3_500_000_000, total: 10_000_000_000 },
  { base: 'OP', name: 'Optimism', category: 'L2', price: 1.8, circulating: 1_100_000_000, total: 4_290_000_000 },
  { base: 'SUI', name: 'Sui', category: 'L1', price: 1.1, circulating: 2_800_000_000, total: 10_000_000_000 },
  { base: 'INJ', name: 'Injective', category: 'DeFi', price: 24, circulating: 97_000_000, total: 100_000_000 },
  { base: 'FIL', name: 'Filecoin', category: 'Storage', price: 4.5, circulating: 600_000_000, total: null },
  { base: 'AAVE', name: 'Aave', category: 'DeFi', price: 95, circulating: 15_000_000, total: 16_000_000 },
  { base: 'SEI', name: 'Sei', category: 'L1', price: 0.45, circulating: 3_600_000_000, total: 10_000_000_000 },
  { base: 'TIA', name: 'Celestia', category: 'L1', price: 6.5, circulating: 200_000_000, total: null },
  { base: 'RUNE', name: 'THORChain', category: 'DeFi', price: 4.8, circulating: 340_000_000, total: 500_000_000 },
  { base: 'FTM', name: 'Fantom', category: 'L1', price: 0.7, circulating: 2_800_000_000, total: 3_175_000_000 },
  { base: 'PEPE', name: 'Pepe', category: 'Meme', price: 0.0000095, circulating: 420_000_000_000_000, total: null },
  { base: 'WIF', name: 'dogwifhat', category: 'Meme', price: 2.4, circulating: 1_000_000_000, total: null },
];

/** Round a price to a magnitude-appropriate precision (keeps sub-cent memecoins). */
function roundPrice(p: number): number {
  if (p >= 1000) return Math.round(p * 100) / 100;
  if (p >= 1) return Math.round(p * 10_000) / 10_000;
  if (p >= 0.01) return Math.round(p * 1_000_000) / 1_000_000;
  return Math.round(p * 1e12) / 1e12;
}

/**
 * Build the synthetic coin-reference universe: each coin's price wiggles around
 * its reference (a day-stable 24h change plus a small minute wiggle, so the
 * board feels alive but is stable within a minute), market cap = price ×
 * circulating supply, and rows are ranked by cap descending. Deterministic for a
 * given minute. Always labeled synthetic — never presented as live market cap.
 */
export async function mockCoinUniverse(limit: number): Promise<CoinUniverse> {
  const now = Date.now();
  const dayBucket = Math.floor(now / 86_400_000);
  const minuteBucket = Math.floor(now / 60_000);

  const coins: CoinRef[] = COIN_UNIVERSE.map((c) => {
    const dayRng = seeded(c.base, dayBucket, 'coinday');
    const minRng = seeded(c.base, minuteBucket, 'coinmin');
    const change24hPct = clamp(gaussian(dayRng) * 2.5, -14, 14);
    const price = roundPrice(c.price * (1 + change24hPct / 100) * (1 + gaussian(minRng) * 0.002));
    const marketCapUsd = Math.round(price * c.circulating);
    return {
      rank: 0, // assigned after the cap sort below
      base: c.base,
      name: c.name,
      priceUsd: price,
      marketCapUsd,
      circulatingSupply: c.circulating,
      totalSupply: c.total,
      fdvUsd: c.total != null ? Math.round(price * c.total) : null,
      change24hPct: Math.round(change24hPct * 100) / 100,
      category: c.category,
    };
  });

  coins.sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
  coins.forEach((coin, i) => {
    coin.rank = i + 1;
  });

  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : COIN_UNIVERSE.length;

  return {
    coins: coins.slice(0, n),
    provenance: 'synthetic',
    source: MOCK_SOURCE,
    note: 'Synthetic reference universe — approximate supplies with a synthetic price wiggle, not live market cap. Configure a live reference source for real figures.',
    asOf: now,
  };
}
