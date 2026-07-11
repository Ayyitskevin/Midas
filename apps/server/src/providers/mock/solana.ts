import type {
  DexPool,
  DexPools,
  SolanaMarket,
  SolanaMarketToken,
  SolanaNetwork,
  SolanaStaking,
  SolanaSwapQuote,
  SolanaTokenHolding,
  SolanaTokenInfo,
  SolanaTrending,
  SolanaTrendingToken,
  SolanaValidator,
  SolanaValidators,
  SolanaWallet,
} from '@midas/shared';
import { gaussian, round, seeded, uniform } from '../util';
import { KNOWN_MINTS, MINT_BY_SYMBOL, MINT_DECIMALS, STABLE_SYMBOLS, shortMint } from '../../solana/rpc';
import { MOCK_SOURCE, SOLANA_DEX_VENUES, SOLANA_TRENDING_ROSTER, resolveEntry } from './fixtures';
import { buildQuote } from './quote';

export async function mockSolanaNetwork(): Promise<SolanaNetwork> {
  // Deterministic-per-minute synthetic network health so SOLNET is useful
  // offline. Clearly labeled synthetic — never presented as a real RPC read.
  const minute = Math.floor(Date.now() / 60_000);
  const rng = seeded('solana', minute, 'solnet');
  const slotsInEpoch = 432_000;
  const slotIndex = Math.floor(uniform(rng, 0.1, 0.95) * slotsInEpoch);
  const solPriceUsd = round(buildQuote(resolveEntry('SOL/USDT')).price, 4);
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic Solana network health for offline/demo use — not a real RPC read. Set MIDAS_SOLANA_RPC (ccxt provider) for live data.',
    slot: 296_000_000 + Math.floor(uniform(rng, 0, 5_000_000)),
    epoch: 685,
    epochProgressPct: round((slotIndex / slotsInEpoch) * 100, 1),
    tps: Math.round(uniform(rng, 1800, 4200)),
    validatorCount: Math.round(uniform(rng, 1400, 1500)),
    totalStakeSol: Math.round(uniform(rng, 385_000_000, 395_000_000)),
    circulatingSupplySol: 468_000_000,
    totalSupplySol: 586_000_000,
    solPriceUsd,
    asOf: Date.now(),
  };
}

export async function mockSolanaWallet(address: string): Promise<SolanaWallet> {
  // Holdings are seeded on the ADDRESS ONLY (stable across polls); only the USD
  // value moves with the live SOL price. Clearly labeled synthetic.
  const rng = seeded(address, 'solwallet');
  const solPrice = buildQuote(resolveEntry('SOL/USDT')).price;
  const solBalance = round(uniform(rng, 0.5, 250), 4);
  const roster: Array<{ mint: string; symbol: string; price: number | null }> = [
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', price: 1 },
    { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', price: 1 },
    { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', price: round(uniform(rng, 0.4, 1.2), 4) },
    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', price: null },
  ];
  const tokens: SolanaTokenHolding[] = roster.map(({ mint, symbol, price }) => {
    const amount = round(uniform(seeded(address, mint, 'amt'), 5, symbol === 'BONK' ? 5_000_000 : 5_000), 2);
    return { mint, symbol, amount, valueUsd: price == null ? null : round(price * amount, 2) };
  });
  const totalValueUsd = round(
    solBalance * solPrice + tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0),
    2,
  );
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic Solana wallet for offline/demo use — not a real on-chain read. Set MIDAS_SOLANA_RPC (ccxt provider) to inspect a real address.',
    address,
    solBalance,
    tokens,
    totalValueUsd,
    asOf: Date.now(),
  };
}

export async function mockSolanaTrending(): Promise<SolanaTrending> {
  // Deterministic-per-minute synthetic trending list so STREND is useful
  // offline. Clearly labeled synthetic — never presented as a live read.
  const minute = Math.floor(Date.now() / 60_000);
  const tokens: SolanaTrendingToken[] = SOLANA_TRENDING_ROSTER.map(({ symbol, price, dex }) => {
    const rng = seeded(symbol, minute, 'strend');
    const px = price * (1 + gaussian(rng) * 0.04);
    const liquidityUsd = Math.floor(uniform(rng, 0.3, 25) * 1_000_000);
    const quote = dex === 'Raydium' ? 'SOL' : 'USDC';
    return {
      symbol,
      pair: `${symbol}/${quote}`,
      dex,
      priceUsd: round(px, px < 0.01 ? 8 : 4),
      change24hPct: round(uniform(rng, -18, 22), 2),
      volume24hUsd: Math.floor(uniform(rng, 0.2, 4) * liquidityUsd),
      liquidityUsd,
    };
  });
  tokens.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic trending Solana tokens for offline/demo use — not real on-chain data. Set MIDAS_DEX_SOURCE=geckoterminal (ccxt provider) for live data.',
    tokens,
    asOf: Date.now(),
  };
}

export async function mockSolanaDexPools(symbol: string): Promise<DexPools> {
  const base = resolveEntry(symbol).symbol.split('/')[0].replace(/:.*$/, '');
  const mid = buildQuote(resolveEntry(`${base}/USDT`)).price;
  const day = Math.floor(Date.now() / 86_400_000);
  const pools: DexPool[] = SOLANA_DEX_VENUES.map(({ dex, feeBps, quote }) => {
    const rng = seeded(base, dex, feeBps, day, 'soldex');
    const liquidityUsd = Math.floor(uniform(rng, 0.3, 30) * 1_000_000);
    return {
      dex,
      pair: `${base}/${quote}`,
      priceUsd: round(mid * (1 + gaussian(rng) * 0.003), 6),
      liquidityUsd,
      volume24hUsd: Math.floor(uniform(rng, 0.2, 4) * liquidityUsd),
      feeBps,
    };
  });
  return {
    symbol: base,
    provenance: 'synthetic',
    note: 'Synthetic Solana DEX pools for offline/demo use — not real on-chain data.',
    pools,
  };
}

export async function mockSolanaValidators(): Promise<SolanaValidators> {
  // Deterministic-per-hour synthetic leaderboard. Clearly labeled synthetic.
  const hour = Math.floor(Date.now() / 3_600_000);
  const count = 30;
  const raw = Array.from({ length: count }, (_, i) => {
    const rng = seeded('solval', i, hour, 'val');
    // Stake decays down the ranking, so the leaderboard looks realistic.
    return {
      stake: Math.floor(uniform(rng, 0.4, 1) * 4_000_000 * Math.pow(0.9, i)),
      commissionPct: Math.round(uniform(rng, 0, 10)),
      delinquent: i > 26 && uniform(rng, 0, 1) > 0.5, // a couple at the tail
      seed: rng,
    };
  });
  const totalStakeSol = raw.reduce((s, v) => s + v.stake, 0);
  const validators: SolanaValidator[] = raw.map((v, i) => ({
    votePubkey: `Vote${i}1111111111111111111111111111111111111`,
    identity: `Node${i}…${(1000 + i).toString(36)}`,
    activatedStakeSol: v.stake,
    commissionPct: v.commissionPct,
    stakeSharePct: Math.round((v.stake / totalStakeSol) * 10000) / 100,
    delinquent: v.delinquent,
    lastVoteSlot: 296_000_000 + Math.floor(uniform(v.seed, 0, 5000)),
  }));
  validators.sort((a, b) => (b.activatedStakeSol ?? 0) - (a.activatedStakeSol ?? 0));
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic Solana validators for offline/demo use — not a real RPC read. Set MIDAS_SOLANA_RPC (ccxt provider) for the live leaderboard.',
    totalStakeSol,
    validatorCount: validators.filter((v) => !v.delinquent).length,
    delinquentCount: validators.filter((v) => v.delinquent).length,
    validators,
    asOf: Date.now(),
  };
}

export async function mockSolanaStaking(): Promise<SolanaStaking> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const rng = seeded('solstake', hour, 'stake');
  const inflation = uniform(rng, 0.044, 0.048); // ~4.5% total, disinflating
  const stakedRatio = uniform(rng, 0.63, 0.67); // ~65% of supply staked
  const epochsPerYear = 182;
  const nominal = inflation / stakedRatio;
  const real = (1 + nominal / epochsPerYear) ** epochsPerYear - 1;
  const pct = (x: number): number => Math.round(x * 1000) / 10;
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic Solana staking economics for offline/demo use — not a real RPC read. Set MIDAS_SOLANA_RPC (ccxt provider) for live data.',
    inflationPct: pct(inflation),
    stakedRatioPct: pct(stakedRatio),
    nominalApyPct: pct(nominal),
    realApyPct: pct(real),
    epochsPerYear,
    asOf: Date.now(),
  };
}

export async function mockSolanaToken(mint: string): Promise<SolanaTokenInfo> {
  // Deterministic-per-mint synthetic token snapshot. Clearly labeled synthetic.
  const symbol = KNOWN_MINTS[mint] ?? shortMint(mint);
  const decimals = MINT_DECIMALS[mint] ?? 6;
  const rng = seeded('spl', mint, 'token');
  const mintActive = uniform(rng, 0, 1) > 0.5;
  const freezeActive = uniform(rng, 0, 1) > 0.6;
  const price = STABLE_SYMBOLS.has(symbol)
    ? 1
    : symbol === 'SOL'
      ? buildQuote(resolveEntry('SOL/USDT')).price
      : null;
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic SPL token data for offline/demo use — not a real RPC read. Set MIDAS_SOLANA_RPC (ccxt provider) for a live read.',
    mint,
    symbol,
    program: 'spl-token',
    decimals,
    supply: Math.floor(uniform(rng, 1, 900) * 1_000_000),
    mintAuthority: mintActive ? 'Mint1111111111111111111111111111111111111' : null,
    mintAuthorityActive: mintActive,
    freezeAuthority: freezeActive ? 'Freeze11111111111111111111111111111111111' : null,
    freezeAuthorityActive: freezeActive,
    priceUsd: price,
    asOf: Date.now(),
  };
}

export async function mockSolanaQuote(input: string, output: string, amount: number): Promise<SolanaSwapQuote> {
  // Synthetic swap quote from a small USD basis; impact grows with notional.
  // Read-only and clearly labeled — the demo never routes or signs anything.
  const inSym = input.toUpperCase();
  const outSym = output.toUpperCase();
  const basis: Record<string, number> = { SOL: 152, USDC: 1, USDT: 1, BONK: 0.000025, JUP: 0.9, JTO: 3.1 };
  const bad = (note: string): SolanaSwapQuote => ({
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note,
    inputSymbol: inSym,
    outputSymbol: outSym,
    inputMint: MINT_BY_SYMBOL[inSym] ?? '',
    outputMint: MINT_BY_SYMBOL[outSym] ?? '',
    inAmount: null,
    outAmount: null,
    price: null,
    priceImpactPct: null,
    slippageBps: null,
    route: [],
    asOf: Date.now(),
  });
  if (basis[inSym] == null || basis[outSym] == null)
    return bad('Synthetic quotes cover a known set (SOL, USDC, USDT, BONK, JUP, JTO).');
  if (inSym === outSym) return bad('Pick two different tokens to quote a swap.');
  if (!(amount > 0)) return bad('Enter a positive input amount to quote.');
  const rng = seeded('sjup', inSym, outSym, Math.round(amount * 100), Math.floor(Date.now() / 60_000));
  const notionalUsd = amount * basis[inSym];
  const impactPct = Math.min(8, Math.sqrt(notionalUsd / 50_000) * 0.5) * (1 + Math.abs(gaussian(rng)) * 0.1);
  const feePct = 0.25;
  const out = ((amount * basis[inSym]) / basis[outSym]) * (1 - impactPct / 100 - feePct / 100);
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic swap quote for offline/demo use — not a live Jupiter route. Set MIDAS_SOLANA_JUPITER (ccxt provider) for live quotes.',
    inputSymbol: inSym,
    outputSymbol: outSym,
    inputMint: MINT_BY_SYMBOL[inSym] ?? '',
    outputMint: MINT_BY_SYMBOL[outSym] ?? '',
    inAmount: amount,
    outAmount: round(out, out < 1 ? 6 : 4),
    price: round(out / amount, out / amount < 1 ? 8 : 4),
    priceImpactPct: round(impactPct, 3),
    slippageBps: 50,
    route: [
      { dex: 'Orca', percent: 60 },
      { dex: 'Raydium', percent: 40 },
    ],
    asOf: Date.now(),
  };
}

export async function mockSolanaMarket(): Promise<SolanaMarket> {
  // Reuse the synthetic trending list (unique per symbol) and roll it up with
  // a SOL price header. Clearly labeled synthetic — never a live read.
  const trending = await mockSolanaTrending();
  const tokens: SolanaMarketToken[] = trending.tokens.map((t) => ({
    symbol: t.symbol,
    priceUsd: t.priceUsd,
    change24hPct: t.change24hPct,
    volume24hUsd: t.volume24hUsd,
    liquidityUsd: t.liquidityUsd,
  }));
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note: 'Synthetic Solana market overview for offline/demo use — not real on-chain data. Set MIDAS_DEX_SOURCE=geckoterminal (ccxt provider) for live data.',
    solPriceUsd: buildQuote(resolveEntry('SOL/USDT')).price,
    totalVolume24hUsd: Math.round(tokens.reduce((s, t) => s + (t.volume24hUsd ?? 0), 0)),
    totalLiquidityUsd: Math.round(tokens.reduce((s, t) => s + (t.liquidityUsd ?? 0), 0)),
    tokenCount: tokens.length,
    tokens,
    asOf: Date.now(),
  };
}
