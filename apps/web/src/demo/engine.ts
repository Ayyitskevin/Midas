import { computeFundingDispersion, computeLiquidationSourceStatuses, computeLiquidationsAggregate, computeLiquidationsCoverage, computeCrossVenueScreen, sortCrossVenueScreen, computeMaxPainStrike, computeOiConcentration, computePutCallOiRatio, computeVenueArbRow, OI_DELTA_WINDOW_MS, summarizeOiDelta } from '@midas/shared';
import { demoReceipt } from './trust';
import type {
  AccountFills,
  AccountPositions,
  Balances,
  BoardEnvelope,
  Candle,
  CoinRef,
  CoinUniverse,
  DerivativesInfo,
  DexPools,
  DvolSnapshot,
  DvolSymbol,
  FundingDispersionRow,
  FundingHistoryPoint,
  FundingRow,
  OiConcentrationRow,
  HistoryResponse,
  Interval,
  LiquidationsFeed,
  NewsItem,
  OiDelta,
  OiDeltaPoint,
  OiDeltaWindow,
  OpenOrders,
  OptionsChain,
  OptionsChainEntry,
  OrderBook,
  Quote,
  Range,
  ScreenerRow,
  SearchResult,
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
  SymbolVenueLiquidations,
  CrossVenueScreenerRow,
  CrossVenueScreenSort,
  VenueScreen,
  VenueScreenRow,
  TermStructure,
  TermStructurePoint,
  VenueArbRow,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';

/**
 * The static demo's data engine — a deterministic, in-browser market that
 * needs no server at all. Prices follow seeded pseudo-random walks anchored
 * to real wall-clock time, so panels visibly move between polls, two tabs
 * agree with each other, and a reload doesn't reshuffle the world.
 *
 * Honesty rules are identical to the server's mock provider: everything is
 * labeled `synthetic`, liquidations say why they can't be trusted, and
 * nothing pretends to be an exchange.
 */

const NOTE = 'Static demo — synthetic data generated in your browser. Deploy your own Midas for live markets.';
export const DEMO_SOURCE = 'demo';

// Deterministic PRNG (mulberry32) + string hash so every (symbol, use) pair
// gets its own stable stream.
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** One stable uniform in [0,1) for a string key. */
const u = (key: string): number => mulberry32(hash(key))();

interface DemoAsset {
  base: string;
  name: string;
  price: number;
  vol: number; // daily volatility as a fraction
}

// A believable universe: majors, L1s, memes — enough for the screener and
// watchlists to feel alive.
const ASSETS: DemoAsset[] = [
  { base: 'BTC', name: 'Bitcoin', price: 67_400, vol: 0.028 },
  { base: 'ETH', name: 'Ethereum', price: 3_520, vol: 0.034 },
  { base: 'SOL', name: 'Solana', price: 158, vol: 0.055 },
  { base: 'BNB', name: 'BNB', price: 585, vol: 0.03 },
  { base: 'XRP', name: 'XRP', price: 0.52, vol: 0.04 },
  { base: 'DOGE', name: 'Dogecoin', price: 0.124, vol: 0.06 },
  { base: 'ADA', name: 'Cardano', price: 0.41, vol: 0.045 },
  { base: 'AVAX', name: 'Avalanche', price: 29.5, vol: 0.055 },
  { base: 'LINK', name: 'Chainlink', price: 14.2, vol: 0.05 },
  { base: 'DOT', name: 'Polkadot', price: 6.1, vol: 0.045 },
  { base: 'TON', name: 'Toncoin', price: 7.4, vol: 0.05 },
  { base: 'MATIC', name: 'Polygon', price: 0.58, vol: 0.05 },
  { base: 'NEAR', name: 'NEAR', price: 5.9, vol: 0.06 },
  { base: 'APT', name: 'Aptos', price: 7.8, vol: 0.06 },
  { base: 'ARB', name: 'Arbitrum', price: 0.82, vol: 0.06 },
  { base: 'OP', name: 'Optimism', price: 1.85, vol: 0.06 },
  { base: 'SUI', name: 'Sui', price: 0.95, vol: 0.07 },
  { base: 'INJ', name: 'Injective', price: 22.5, vol: 0.07 },
  { base: 'PEPE', name: 'Pepe', price: 0.0000112, vol: 0.09 },
  { base: 'WIF', name: 'dogwifhat', price: 2.1, vol: 0.1 },
  { base: 'LTC', name: 'Litecoin', price: 74, vol: 0.035 },
  { base: 'BCH', name: 'Bitcoin Cash', price: 385, vol: 0.04 },
  { base: 'ATOM', name: 'Cosmos', price: 6.8, vol: 0.05 },
  { base: 'FIL', name: 'Filecoin', price: 4.5, vol: 0.055 },
  { base: 'UNI', name: 'Uniswap', price: 8.1, vol: 0.05 },
  { base: 'AAVE', name: 'Aave', price: 92, vol: 0.055 },
  { base: 'SEI', name: 'Sei', price: 0.34, vol: 0.07 },
  { base: 'TIA', name: 'Celestia', price: 5.2, vol: 0.075 },
  { base: 'RUNE', name: 'THORChain', price: 4.4, vol: 0.07 },
  { base: 'FTM', name: 'Fantom', price: 0.46, vol: 0.065 },
];

const QUOTE_CCY = 'USDT';
const VENUES = ['binance', 'coinbase', 'kraken', 'bitfinex', 'okx', 'kucoin'];

export const DEMO_SYMBOLS: string[] = ASSETS.map((a) => `${a.base}/${QUOTE_CCY}`);

const assetFor = (symbol: string): DemoAsset | null => {
  const base = symbol.toUpperCase().split(/[/:]/)[0];
  return ASSETS.find((a) => a.base === base) ?? null;
};

// The heart: a smooth deterministic walk. Price(t) is a product of slow sine
// drifts + a per-hour seeded shock, so it's continuous, mean-reverting-ish,
// and identical for everyone at the same wall-clock minute.
const TICK_MS = 15_000;

function priceAt(asset: DemoAsset, tMs: number): number {
  const t = tMs / 86_400_000; // days
  const s = hash(asset.base);
  const slow = Math.sin(t * 2 * Math.PI * 0.9 + s % 7) * 0.5 + Math.sin(t * 2 * Math.PI * 0.23 + s % 13) * 0.35;
  const hour = Math.floor(tMs / 3_600_000);
  const shock = (u(`${asset.base}:h${hour}`) - 0.5) * 1.2;
  const tick = Math.floor(tMs / TICK_MS);
  const jitter = (u(`${asset.base}:t${tick}`) - 0.5) * 0.25;
  return asset.price * (1 + asset.vol * (slow + shock + jitter));
}

/**
 * Supplies + categories for the market-cap reference board (TOP), keyed by base.
 * Kept in parity with the server's mock fixture (apps/server/src/providers/mock/
 * coins.ts) — approximate figures for a synthetic-but-realistic ranking. Prices
 * come from the demo walk (priceAt), so the board agrees with the rest of the
 * demo. Always labeled synthetic; never presented as live market cap.
 */
const COIN_SUPPLY: Record<string, { circ: number; total: number | null; cat: string }> = {
  BTC: { circ: 19_800_000, total: 21_000_000, cat: 'L1' },
  ETH: { circ: 120_400_000, total: null, cat: 'L1' },
  BNB: { circ: 146_000_000, total: 146_000_000, cat: 'Exchange' },
  SOL: { circ: 470_000_000, total: null, cat: 'L1' },
  XRP: { circ: 57_000_000_000, total: 100_000_000_000, cat: 'Payments' },
  DOGE: { circ: 146_000_000_000, total: null, cat: 'Meme' },
  ADA: { circ: 35_000_000_000, total: 45_000_000_000, cat: 'L1' },
  TON: { circ: 2_500_000_000, total: null, cat: 'L1' },
  AVAX: { circ: 400_000_000, total: 720_000_000, cat: 'L1' },
  LINK: { circ: 620_000_000, total: 1_000_000_000, cat: 'Oracle' },
  DOT: { circ: 1_450_000_000, total: null, cat: 'L1' },
  MATIC: { circ: 9_300_000_000, total: 10_000_000_000, cat: 'L2' },
  NEAR: { circ: 1_100_000_000, total: null, cat: 'L1' },
  LTC: { circ: 75_000_000, total: 84_000_000, cat: 'Payments' },
  BCH: { circ: 19_800_000, total: 21_000_000, cat: 'Payments' },
  UNI: { circ: 600_000_000, total: 1_000_000_000, cat: 'DeFi' },
  ATOM: { circ: 390_000_000, total: null, cat: 'L1' },
  APT: { circ: 480_000_000, total: null, cat: 'L1' },
  ARB: { circ: 3_500_000_000, total: 10_000_000_000, cat: 'L2' },
  OP: { circ: 1_100_000_000, total: 4_290_000_000, cat: 'L2' },
  SUI: { circ: 2_800_000_000, total: 10_000_000_000, cat: 'L1' },
  INJ: { circ: 97_000_000, total: 100_000_000, cat: 'DeFi' },
  FIL: { circ: 600_000_000, total: null, cat: 'Storage' },
  AAVE: { circ: 15_000_000, total: 16_000_000, cat: 'DeFi' },
  SEI: { circ: 3_600_000_000, total: 10_000_000_000, cat: 'L1' },
  TIA: { circ: 200_000_000, total: null, cat: 'L1' },
  RUNE: { circ: 340_000_000, total: 500_000_000, cat: 'DeFi' },
  FTM: { circ: 2_800_000_000, total: 3_175_000_000, cat: 'L1' },
  PEPE: { circ: 420_000_000_000_000, total: null, cat: 'Meme' },
  WIF: { circ: 1_000_000_000, total: null, cat: 'Meme' },
};

/** The market-cap reference universe (TOP), ranked by cap — synthetic, in-browser. */
export function coinUniverseFor(limit: number, now: number): CoinUniverse {
  const coins: CoinRef[] = ASSETS.filter((a) => COIN_SUPPLY[a.base]).map((a) => {
    const meta = COIN_SUPPLY[a.base];
    const price = priceAt(a, now);
    const prev = priceAt(a, now - 86_400_000);
    const change24hPct = prev !== 0 ? ((price - prev) / prev) * 100 : 0;
    return {
      rank: 0,
      base: a.base,
      name: a.name,
      priceUsd: price,
      marketCapUsd: Math.round(price * meta.circ),
      circulatingSupply: meta.circ,
      totalSupply: meta.total,
      fdvUsd: meta.total != null ? Math.round(price * meta.total) : null,
      change24hPct: Math.round(change24hPct * 100) / 100,
      category: meta.cat,
    };
  });
  coins.sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
  coins.forEach((c, i) => {
    c.rank = i + 1;
  });
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : coins.length;
  return { coins: coins.slice(0, n), provenance: 'synthetic', source: DEMO_SOURCE, note: NOTE, asOf: now };
}

export function quoteFor(symbol: string, now: number): Quote | null {
  const asset = assetFor(symbol);
  if (!asset) return null;
  const price = priceAt(asset, now);
  const prevClose = priceAt(asset, now - 86_400_000);
  const dayHigh = Math.max(price, prevClose) * (1 + asset.vol * 0.35);
  const dayLow = Math.min(price, prevClose) * (1 - asset.vol * 0.35);
  const volume = asset.price > 1000 ? 25_000 : asset.price > 10 ? 900_000 : 60_000_000;
  return {
    symbol: `${asset.base}/${QUOTE_CCY}`,
    name: asset.name,
    currency: QUOTE_CCY,
    exchange: DEMO_SOURCE,
    marketState: 'REGULAR',
    price,
    previousClose: prevClose,
    open: priceAt(asset, now - (now % 86_400_000)),
    dayHigh,
    dayLow,
    change: price - prevClose,
    changePercent: prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : 0,
    volume: volume * (0.8 + u(`${asset.base}:vol`) * 0.4),
    marketCap: null,
    fiftyTwoWeekHigh: asset.price * (1 + asset.vol * 14),
    fiftyTwoWeekLow: asset.price * (1 - asset.vol * 10),
    asOf: now,
  };
}

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1wk': 604_800_000,
};
const RANGE_MS: Record<string, number> = {
  '1d': 86_400_000,
  '5d': 5 * 86_400_000,
  '1mo': 30 * 86_400_000,
  '3mo': 90 * 86_400_000,
  '6mo': 180 * 86_400_000,
  '1y': 365 * 86_400_000,
  '2y': 730 * 86_400_000,
  '5y': 1825 * 86_400_000,
  max: 1825 * 86_400_000,
};

export function historyFor(symbol: string, interval: string, range: string, now: number): HistoryResponse | null {
  const asset = assetFor(symbol);
  if (!asset) return null;
  // Resolve unknown interval/range to the server's defaults (1d / 6mo) rather
  // than echoing an invalid string back — mirrors the server's isInterval/
  // isRange validation.
  const okInterval = (INTERVAL_MS[interval] ? interval : '1d') as Interval;
  const okRange = (RANGE_MS[range] ? range : '6mo') as Range;
  const step = INTERVAL_MS[okInterval];
  const span = RANGE_MS[okRange];
  const count = Math.min(1500, Math.max(30, Math.floor(span / step)));
  const end = now - (now % step);
  const candles: Candle[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t0 = end - i * step;
    const open = priceAt(asset, t0);
    const close = priceAt(asset, t0 + step - 1);
    const wick = asset.vol * Math.sqrt(step / 86_400_000) * 0.9;
    const high = Math.max(open, close) * (1 + wick * u(`${asset.base}:hi${t0}`));
    const low = Math.min(open, close) * (1 - wick * u(`${asset.base}:lo${t0}`));
    const volume = (asset.price > 1000 ? 800 : 40_000) * (0.5 + u(`${asset.base}:v${t0}`));
    candles.push({ time: Math.floor(t0 / 1000), open, high, low, close, volume });
  }
  return {
    symbol: `${asset.base}/${QUOTE_CCY}`,
    interval: okInterval,
    range: okRange,
    currency: QUOTE_CCY,
    candles,
  };
}

export function orderBookFor(symbol: string, depth: number, now: number): OrderBook | null {
  const asset = assetFor(symbol);
  if (!asset) return null;
  const mid = priceAt(asset, now);
  const spread = mid * 0.0004;
  // Match the server's depth cap (100) — TICKET/SLIP/TWAP request depth=100 and
  // would otherwise simulate against a half-depth book in the demo.
  const levels = Math.min(100, Math.max(5, depth));
  const bids = [];
  const asks = [];
  for (let i = 0; i < levels; i++) {
    const stepPct = 0.0004 * (i + 1) * (1 + i * 0.08);
    const size = (asset.price > 1000 ? 0.4 : 250) * (0.3 + u(`${asset.base}:b${i}:${Math.floor(now / TICK_MS)}`)) * (1 + i * 0.35);
    bids.push({ price: (mid - spread / 2) * (1 - stepPct), amount: size });
    asks.push({
      price: (mid + spread / 2) * (1 + stepPct),
      amount: (asset.price > 1000 ? 0.4 : 250) * (0.3 + u(`${asset.base}:a${i}:${Math.floor(now / TICK_MS)}`)) * (1 + i * 0.35),
    });
  }
  return { symbol: `${asset.base}/${QUOTE_CCY}`, bids, asks, timestamp: now };
}

// Deterministic per-symbol funding cadence (hours), mirroring the server mock
// (apps/server/src/providers/mock/derivatives.ts): SOL funds hourly, DOGE on a
// 4h cadence, everything else 8h. Without a known interval the shared
// funding-dispersion compute excludes the venue entirely — an unknown cadence
// must never be silently treated as 8h.
const FUNDING_INTERVAL_HOURS: Record<string, number> = { SOL: 1, DOGE: 4 };
const fundingIntervalFor = (base: string): number => FUNDING_INTERVAL_HOURS[base] ?? 8;

export function derivativesFor(symbol: string, now: number): DerivativesInfo | null {
  const asset = assetFor(symbol);
  if (!asset) return null;
  const mark = priceAt(asset, now);
  const hour = Math.floor(now / 3_600_000);
  const funding = ((u(`${asset.base}:f${Math.floor(hour / 8)}`) - 0.45) * 0.0004);
  const oi = (asset.price > 1000 ? 80_000 : 4_000_000) * (0.7 + u(`${asset.base}:oi`) * 0.6);
  const intervalHours = fundingIntervalFor(asset.base);
  const stepMs = intervalHours * 3_600_000;
  return {
    symbol: `${asset.base}/${QUOTE_CCY}:${QUOTE_CCY}`,
    fundingRate: funding,
    fundingIntervalHours: intervalHours,
    // Next settlement at the next boundary of this symbol's cadence (like the
    // server mock's nextFundingBoundary), not a blanket 8h boundary.
    nextFundingTime: (Math.floor(now / stepMs) + 1) * stepMs,
    markPrice: mark,
    indexPrice: mark * (1 - funding / 3),
    openInterest: oi,
    openInterestValue: oi * mark,
    recentLiquidations: [],
    timestamp: now,
  };
}

export function fundingRows(quote: string, limit: number, now: number): FundingRow[] {
  return ASSETS.slice(0, limit).map((a) => {
    const d = derivativesFor(`${a.base}/${quote}`, now)!;
    return {
      symbol: `${a.base}/${quote}`,
      fundingRate: d.fundingRate,
      fundingIntervalHours: d.fundingIntervalHours ?? null,
      nextFundingTime: d.nextFundingTime,
      markPrice: d.markPrice,
      openInterestValue: d.openInterestValue,
    };
  });
}

/**
 * Wrap a fan-out board in the shared BoardEnvelope — the exact shape the
 * server returns for /api/funding, /api/funding-dispersion, /api/venue-arb and
 * /api/oi-concentration. The demo never caches and never drops a symbol, so
 * cachedAt is null and partial is false; provenance is always synthetic.
 */
export function boardEnvelope<T>(rows: T[], now: number): BoardEnvelope<T> {
  return {
    rows,
    meta: { provenance: 'synthetic', source: DEMO_SOURCE, asOf: now, cachedAt: null, partial: false, note: NOTE },
  };
}

export function fundingDispersionRows(quote: string, limit: number, now: number): FundingDispersionRow[] {
  return ASSETS.slice(0, limit)
    .map((a) => computeFundingDispersion(`${a.base}/${quote}`, venueDerivatives(`${a.base}/${quote}`, now)))
    .filter((r) => r.spreadBps !== null)
    .sort((a, b) => (b.spreadBps ?? 0) - (a.spreadBps ?? 0));
}

export function fundingHistoryFor(symbol: string, limit: number, now: number): FundingHistoryPoint[] {
  const asset = assetFor(symbol);
  if (!asset) return [];
  const out: FundingHistoryPoint[] = [];
  const anchor = Math.floor(now / 28_800_000) * 28_800_000;
  for (let i = limit - 1; i >= 0; i--) {
    const t = anchor - i * 28_800_000;
    out.push({
      time: t,
      fundingRate: (u(`${asset.base}:fh${t}`) - 0.45) * 0.0004,
      fundingIntervalHours: 8,
      receipt: demoReceipt('funding-history', symbol, now, {
        sourceAsOf: t,
        units: { fundingRate: 'fraction', fundingIntervalHours: 'hours' },
      }),
    });
  }
  return out;
}

export function venueQuotes(symbol: string, now: number): VenueQuote[] {
  const asset = assetFor(symbol);
  if (!asset) return [];
  const mid = priceAt(asset, now);
  return VENUES.map((v) => {
    const skew = (u(`${v}:${asset.base}:q`) - 0.5) * 0.0016;
    const price = mid * (1 + skew);
    const topSize = (asset.price > 1_000 ? 0.5 : 300) * (0.5 + u(`${v}:${asset.base}:top-size`));
    const value: VenueQuote = {
      exchange: v,
      price,
      bid: price * 0.9998,
      ask: price * 1.0002,
      bidSize: topSize,
      askSize: topSize * (0.8 + u(`${v}:${asset.base}:ask-size`) * 0.4),
      changePercent: quoteFor(symbol, now)!.changePercent + (u(`${v}:${asset.base}:c`) - 0.5) * 0.4,
      volume: (asset.price > 1000 ? 20_000 : 2_000_000) * (0.4 + u(`${v}:${asset.base}:v`)),
      timestamp: now,
    };
    return {
      ...value,
      receipt: demoReceipt('venue-quotes', symbol, now, {
        venue: v,
        sourceAsOf: now,
        units: { price: 'quote', bid: 'quote', ask: 'quote', bidSize: 'base', askSize: 'base' },
      }),
    };
  });
}

export function venueArbRows(quote: string, limit: number, now: number): VenueArbRow[] {
  return ASSETS.slice(0, limit)
    .map((a) => computeVenueArbRow(`${a.base}/${quote}`, venueQuotes(`${a.base}/${quote}`, now), now))
    .filter((r) => r.dispersionBps !== null)
    .sort((a, b) => (b.dispersionBps ?? 0) - (a.dispersionBps ?? 0));
}

export function venueDerivatives(symbol: string, now: number): VenueDerivatives[] {
  const base = derivativesFor(symbol, now);
  if (!base) return [];
  return VENUES.map((v) => {
    const value: VenueDerivatives = {
      exchange: v,
      fundingRate:
        base.fundingRate == null
          ? null
          : base.fundingRate + (u(`${v}:${symbol}:vf`) - 0.5) * 0.0002,
      fundingIntervalHours: base.fundingIntervalHours ?? null,
      nextFundingTime: base.nextFundingTime,
      markPrice:
        base.markPrice == null
          ? null
          : base.markPrice * (1 + (u(`${v}:${symbol}:vm`) - 0.5) * 0.001),
      openInterestValue:
        base.openInterestValue == null
          ? null
          : base.openInterestValue * (0.2 + u(`${v}:${symbol}:vo`)),
      timestamp: now,
    };
    return {
      ...value,
      receipt: demoReceipt('venue-derivatives', symbol, now, {
        venue: v,
        sourceAsOf: now,
        units: {
          fundingRate: 'fraction per settlement',
          fundingIntervalHours: 'hours',
          markPrice: 'quote',
          openInterestValue: 'quote',
        },
      }),
    };
  });
}

export function oiConcentrationRows(quote: string, limit: number, now: number): OiConcentrationRow[] {
  return ASSETS.slice(0, limit)
    .map((a) => computeOiConcentration(`${a.base}/${quote}`, venueDerivatives(`${a.base}/${quote}`, now)))
    .filter((r) => r.totalOiValue !== null)
    .sort((a, b) => (b.totalOiValue ?? 0) - (a.totalOiValue ?? 0));
}

/**
 * Synthetic OI-delta positioning — parity with the server mock (apps/server/
 * src/providers/mock/oiDelta.ts). The price leg samples the demo's own
 * time-anchored walk (priceAt), so the last point is the price every other
 * panel shows; the OI walk is correlated with the price returns by a
 * per-asset regime, so the four ΔOI × Δprice quadrants emerge from the series
 * rather than being pasted on. Always labeled synthetic.
 */
export function oiDeltaFor(symbol: string, window: OiDeltaWindow, now: number): OiDelta {
  const asset = assetFor(symbol);
  const base = symbol.toUpperCase().split(/[/:]/)[0];
  const perp = `${base}/USDT:USDT`;
  if (!asset) {
    return {
      symbol: perp,
      window,
      oiNow: null,
      oiThen: null,
      oiChangePct: null,
      priceChangePct: null,
      classification: null,
      points: [],
      asOf: null,
      provenance: 'unavailable',
      source: DEMO_SOURCE,
      note: 'Unknown demo asset.',
    };
  }
  const N = 48;
  const bucketMs = OI_DELTA_WINDOW_MS[window] / N;
  const corr = u(`${asset.base}:oidregime`) * 2 - 1;
  const amp = 0.5 + u(`${asset.base}:oidamp`) * 2; // OI % response per 1% of price
  const mid = priceAt(asset, now);
  const oiBase = Math.floor((1_000 + u(`${asset.base}:oidbase`) * 249_000) * (asset.price > 1000 ? 1 : 1000)) * mid;

  const prices = Array.from({ length: N }, (_, i) => priceAt(asset, now - (N - 1 - i) * bucketMs));
  const oiCum: number[] = [0];
  for (let i = 1; i < N; i++) {
    const priceRet = prices[i - 1] > 0 ? prices[i] / prices[i - 1] - 1 : 0;
    const noise = (u(`${asset.base}:oidnoise${window}:${Math.floor((now - (N - 1 - i) * bucketMs) / bucketMs)}`) - 0.5) * 0.008;
    oiCum.push(oiCum[i - 1] + corr * amp * priceRet + noise);
  }
  const points: OiDeltaPoint[] = prices.map((price, i) => ({
    timestamp: now - (N - 1 - i) * bucketMs,
    openInterestValue: Math.round(oiBase * Math.exp(oiCum[i])),
    price: Math.round(price * 1e6) / 1e6,
  }));

  return {
    symbol: perp,
    window,
    ...summarizeOiDelta(points),
    points,
    provenance: 'synthetic',
    source: DEMO_SOURCE,
    note: NOTE,
  };
}

// --- Options / DVOL / futures term structure -------------------------------
// Synthetic parity with the server mock (apps/server/src/providers/mock/
// options.ts): a contango term structure, an IV smile, max pain near round
// strikes, always labeled synthetic. Deribit-style Friday 08:00 UTC expiries
// and instrument date codes, so the demo renders like the live surface.

const OPTION_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Deribit-style instrument date code: 27SEP24. */
function optionDateCode(expiryMs: number): string {
  const d = new Date(expiryMs);
  return `${d.getUTCDate()}${OPTION_MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
}

/** Next Friday 08:00 UTC (the Deribit expiry convention), `weeksOut` weeks later. */
function fridayExpiry(now: number, weeksOut: number): number {
  const d = new Date(now);
  let delta = (5 - d.getUTCDay() + 7) % 7;
  if (delta === 0 && d.getUTCHours() >= 8) delta = 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta + weeksOut * 7, 8);
}

/** Strike step for an underlying of this price: round, Deribit-like increments. */
function optionStrikeStep(mid: number): number {
  if (mid >= 20_000) return 1_000;
  if (mid >= 2_000) return 100;
  if (mid >= 200) return 10;
  if (mid >= 20) return 1;
  return 0.5;
}

/** Synthetic DVOL snapshot — the same shape as the server mock's. */
export function dvolFor(symbol: DvolSymbol, now: number): DvolSnapshot {
  const day = Math.floor(now / 86_400_000);
  const base = symbol === 'BTC' ? 52 : 63;
  const history = Array.from({ length: 30 }, (_, i) => {
    const d = day - (29 - i);
    return {
      time: d * 86_400_000,
      value: Math.round((base + Math.sin(d / 4) * 6 + (u(`${symbol}:dvol${d}`) - 0.5) * 8) * 100) / 100,
    };
  });
  const hour = Math.floor(now / 3_600_000);
  const value = Math.round((history[history.length - 1].value + (u(`${symbol}:dvolh${hour}`) - 0.5) * 1.6) * 100) / 100;
  return { symbol, value, history, asOf: now, provenance: 'synthetic', source: DEMO_SOURCE, note: NOTE };
}

/** Synthetic dated-futures term structure — gentle contango, nearest-first. */
export function termStructureFor(symbol: string, now: number): TermStructure {
  const asset = assetFor(symbol);
  const base = symbol.toUpperCase().split(/[/:]/)[0];
  if (!asset) {
    return {
      underlying: base,
      referencePrice: null,
      perpPrice: null,
      points: [],
      asOf: null,
      provenance: 'unavailable',
      source: DEMO_SOURCE,
      note: 'Unknown demo asset.',
    };
  }
  const mid = priceAt(asset, now);
  const hour = Math.floor(now / 3_600_000);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const points: TermStructurePoint[] = [0, 1, 2, 4, 13].map((w) => {
    const expiry = fridayExpiry(now, w);
    const daysToExpiry = (expiry - now) / 86_400_000;
    const basisPct = round2(3 + 6 * Math.sqrt(daysToExpiry / 365) + (u(`${asset.base}:term${w}:${hour}`) - 0.5) * 0.8);
    return {
      expiry,
      futureSymbol: `${asset.base}-${optionDateCode(expiry)}`,
      price: round2(mid * (1 + (basisPct / 100) * (daysToExpiry / 365))),
      annualizedBasisPct: basisPct,
      daysToExpiry: Math.round(daysToExpiry * 10) / 10,
    };
  });
  return {
    underlying: asset.base,
    referencePrice: mid,
    perpPrice: round2(mid * (1 + (u(`${asset.base}:termperp${hour}`) - 0.5) * 0.001)),
    points,
    asOf: now,
    provenance: 'synthetic',
    source: DEMO_SOURCE,
    note: NOTE,
  };
}

/** Synthetic options chain — OI hump near the money, IV smile, derived max pain/PCR. */
export function optionsChainFor(symbol: string, expiry: number | 'nearest', now: number): OptionsChain {
  const asset = assetFor(symbol);
  const base = symbol.toUpperCase().split(/[/:]/)[0];
  if (!asset) {
    return {
      underlying: base,
      expiry: typeof expiry === 'number' ? expiry : 0,
      underlyingPrice: null,
      entries: [],
      maxPainStrike: null,
      putCallOiRatio: null,
      asOf: null,
      provenance: 'unavailable',
      source: DEMO_SOURCE,
      note: 'Unknown demo asset.',
    };
  }
  const mid = priceAt(asset, now);
  const target = expiry === 'nearest' ? fridayExpiry(now, 0) : expiry;
  const daysToExpiry = Math.max((target - now) / 86_400_000, 0.5);
  const day = Math.floor(now / 86_400_000);
  const step = optionStrikeStep(mid);
  const atm = Math.round(mid / step) * step;
  const ivBase = asset.base === 'BTC' ? 52 : asset.base === 'ETH' ? 63 : 70;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const entries: OptionsChainEntry[] = [];
  for (let i = -10; i <= 10; i++) {
    const k = atm + i * step;
    if (k <= 0) continue;
    const moneyness = (k - mid) / mid;
    const hump = Math.exp(-Math.pow(i / 6, 2));
    const roundBoost = k % (step * 5) === 0 ? 1.5 : 1;
    const callOi = Math.floor((300 + u(`${asset.base}:coi${k}:${day}`) * 600) * hump * roundBoost * (1 + Math.max(moneyness, 0) * 3));
    const putOi = Math.floor((300 + u(`${asset.base}:poi${k}:${day}`) * 600) * hump * roundBoost * (1 + Math.max(-moneyness, 0) * 3));
    const iv = round1(ivBase + moneyness * moneyness * 220 + (u(`${asset.base}:iv${k}:${day}`) - 0.5) * 3);
    const timeValue = mid * (iv / 100) * Math.sqrt(daysToExpiry / 365) * 0.4 * hump;
    entries.push({
      strike: k,
      expiry: target,
      callOi,
      putOi,
      callMark: round2(Math.max(mid - k, 0) + timeValue),
      putMark: round2(Math.max(k - mid, 0) + timeValue),
      iv,
    });
  }
  const pcr = computePutCallOiRatio(entries);
  return {
    underlying: asset.base,
    expiry: target,
    underlyingPrice: mid,
    entries,
    maxPainStrike: computeMaxPainStrike(entries),
    putCallOiRatio: pcr == null ? null : Math.round(pcr * 1000) / 1000,
    asOf: now,
    provenance: 'synthetic',
    source: DEMO_SOURCE,
    note: NOTE,
  };
}

/**
 * Synthetic per-venue screener sweeps, mirroring the server mock: venues
 * disagree slightly on price, carry different volumes, and the last two list
 * only the majors so `venueCount` actually varies. One venue withholds 24h
 * change so the aggregate exercises the null-weight path.
 */
export function venueScreenRows(quote: string, now: number): VenueScreen[] {
  return VENUES.map((venue, venueIndex) => {
    const listed = venueIndex >= VENUES.length - 2 ? ASSETS.slice(0, 8) : ASSETS;
    const rows: VenueScreenRow[] = listed.map((a) => {
      const q = quoteFor(`${a.base}/${quote}`, now)!;
      const price = q.price * (1 + (u(`vscreen:p:${a.base}:${venue}`) - 0.5) * 0.0012);
      const volume = q.volume === null ? null : q.volume * (0.05 + u(`vscreen:v:${a.base}:${venue}`) * 0.55);
      return {
        symbol: q.symbol,
        name: a.name,
        price,
        changePercent: venueIndex === 1 ? null : q.changePercent + (u(`vscreen:c:${a.base}:${venue}`) - 0.5) * 0.3,
        volume,
        quoteVolume: volume === null ? null : volume * price,
      };
    });
    return { exchange: venue, available: true, rows, timestamp: now };
  });
}

/** The cross-venue screener board the demo serves, mirroring the server route. */
export function venueScreenerRows(
  quote: string,
  sort: CrossVenueScreenSort,
  limit: number,
  now: number,
): CrossVenueScreenerRow[] {
  return sortCrossVenueScreen(computeCrossVenueScreen(venueScreenRows(quote, now)), sort).slice(0, limit);
}

export function screenerRows(quote: string, sort: string, limit: number, now: number): ScreenerRow[] {
  const rows = ASSETS.map((a) => {
    const q = quoteFor(`${a.base}/${quote}`, now)!;
    return {
      symbol: q.symbol,
      name: a.name,
      price: q.price,
      changePercent: q.changePercent,
      volume: q.volume,
      quoteVolume: q.volume != null ? q.volume * q.price : null,
    };
  });
  // Mirror the server's sortScreener (providers/util.ts): price/change sort on
  // their own field, everything else on quote volume. Without the price branch a
  // PRICE sort (offered by the Screener panel) silently returned volume order.
  const field = (r: { price: number; changePercent: number; quoteVolume: number | null }): number =>
    sort === 'gainers' || sort === 'change'
      ? r.changePercent
      : sort === 'price'
        ? r.price
        : (r.quoteVolume ?? 0);
  rows.sort((a, b) => field(b) - field(a));
  if (sort === 'losers') rows.reverse();
  return rows.slice(0, limit);
}

export function searchFor(query: string): SearchResult[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  return ASSETS.filter((a) => a.base.includes(q) || a.name.toUpperCase().includes(q))
    .slice(0, 12)
    .map((a) => ({
      symbol: `${a.base}/${QUOTE_CCY}`,
      name: a.name,
      exchange: DEMO_SOURCE,
      type: 'CRYPTOCURRENCY',
    }));
}

/**
 * Demo venues without a public liquidation feed. Mirrors both reality (Binance
 * removed its public stream in 2021) and the server mock's fixture, so the demo
 * exercises the same partial-coverage branches the real panel hits.
 */
const NO_LIQUIDATION_FEED_VENUES = new Set(['binance', 'coinbase']);

export function liquidationsFeed(quote: string, limit: number, now: number): LiquidationsFeed {
  // Fan out across the demo venue set exactly as the server does, then reduce
  // with the SAME shared helpers — a hand-copied shape is how demo and server
  // silently drift apart.
  const symbols = Array.from(
    new Set(
      Array.from({ length: Math.min(limit, 25) }, (_, i) => {
        const a = ASSETS[Math.floor(u(`liq:a${i}:${Math.floor(now / 60_000)}`) * ASSETS.length)];
        return `${a.base}/${quote}`;
      }),
    ),
  );
  const perSymbol: SymbolVenueLiquidations[] = symbols.map((symbol) => ({
    symbol,
    venues: VENUES.map((venue) => {
      if (NO_LIQUIDATION_FEED_VENUES.has(venue)) {
        return { exchange: venue, available: true as const, liquidations: [], timestamp: null };
      }
      const asset = assetFor(symbol)!;
      const liquidations = Array.from({ length: 3 }, (_, i) => {
        const timestamp = now - i * 47_000 - hash(`${symbol}:${venue}`) % 9_000;
        const price = priceAt(asset, timestamp);
        return {
          side: u(`liq:d:${symbol}:${venue}:${i}`) > 0.45 ? ('sell' as const) : ('buy' as const),
          price,
          amount: (asset.price > 1000 ? 0.6 : 4_000) * (0.2 + u(`liq:s:${symbol}:${venue}:${i}`) * 2),
          timestamp,
        };
      });
      return {
        exchange: venue,
        available: true as const,
        liquidations,
        timestamp: Math.max(...liquidations.map((l) => l.timestamp)),
      };
    }).map((venue) => ({
      ...venue,
      // The two feedless venues report available:false, like the server mock.
      available: !NO_LIQUIDATION_FEED_VENUES.has(venue.exchange),
    })),
  }));

  // VENUES[0] is the primary — the single-source reference the multiple is
  // measured against. It publishes nothing, mirroring the real default.
  const aggregate = computeLiquidationsAggregate(perSymbol, VENUES[0]);
  const sources = computeLiquidationSourceStatuses(
    VENUES.map((venue) => ({
      source: venue,
      available: !NO_LIQUIDATION_FEED_VENUES.has(venue),
      // Fabricated events have no upstream stream to throttle.
      throttled: false,
      synthetic: true,
      note: NOTE,
    })),
    aggregate.observations,
    now,
  );
  return {
    events: aggregate.events.slice(0, 120),
    meta: {
      source: DEMO_SOURCE,
      available: true,
      synthetic: true, // demo events are fabricated in-browser — never shown as 'live'
      note: NOTE,
      asOf: now,
      sampledSource: VENUES[0],
      sources,
      coverage: computeLiquidationsCoverage(sources),
      aggregate: {
        totalValue: aggregate.totalValue,
        referenceSource: aggregate.referenceSource,
        referenceValue: aggregate.referenceValue,
        multiple: aggregate.multiple,
      },
    },
  };
}

export function dexPoolsFor(symbol: string, now: number): DexPools {
  const asset = assetFor(symbol);
  if (!asset) {
    return { symbol: symbol.toUpperCase(), provenance: 'unavailable', note: 'Unknown demo asset.', pools: [] };
  }
  const price = priceAt(asset, now);
  const pools = [
    { dex: 'Uniswap v3', pair: `W${asset.base}/USDC`, feeBps: 5 },
    { dex: 'Uniswap v3', pair: `W${asset.base}/USDC`, feeBps: 30 },
    { dex: 'Curve', pair: `${asset.base}/3pool`, feeBps: 4 },
    { dex: 'PancakeSwap', pair: `${asset.base}/USDT`, feeBps: 25 },
  ].map((p, i) => ({
    ...p,
    priceUsd: price * (1 + (u(`${asset.base}:dex${i}`) - 0.5) * 0.002),
    liquidityUsd: 40_000_000 * (0.1 + u(`${asset.base}:tvl${i}`)) * (asset.price > 1000 ? 4 : 1),
    volume24hUsd: 15_000_000 * (0.1 + u(`${asset.base}:dv${i}`)),
  }));
  return { symbol: asset.base, provenance: 'synthetic', note: NOTE, pools };
}

export function newsFor(symbol: string | undefined, now: number): NewsItem[] {
  const base = symbol ? (assetFor(symbol)?.base ?? 'BTC') : 'BTC';
  const headlines = [
    `${base} funding flips positive as open interest builds`,
    `Desk note: ${base} basis widens into the weekly close`,
    `On-chain: ${base} exchange balances at a 30-day low`,
    `Options desks report renewed ${base} call buying`,
    `Static demo: these headlines are synthetic examples`,
  ];
  return headlines.map((title, i) => ({
    id: `demo-news-${base}-${i}`,
    title,
    publisher: 'Midas Demo Wire',
    link: 'https://github.com/Ayyitskevin/Midas',
    publishedAt: now - i * 3_600_000 * 5,
    relatedSymbols: [`${base}/${QUOTE_CCY}`],
    summary: NOTE,
  }));
}

// --- Synthetic account (matches the server mock's spirit: labeled, useful) --

/** Synthetic Solana network health — moves each minute, SOL priced from the walk. */
export function solanaNetworkFor(now: number): SolanaNetwork {
  const minute = Math.floor(now / 60_000);
  const slotsInEpoch = 432_000;
  const slotIndex = Math.floor((0.1 + u(`solnet:idx${minute}`) * 0.85) * slotsInEpoch);
  const solPriceUsd = priceAt(ASSETS[2], now); // ASSETS[2] === SOL
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    slot: 296_000_000 + Math.floor(u(`solnet:slot${minute}`) * 5_000_000),
    epoch: 685,
    epochProgressPct: Math.round((slotIndex / slotsInEpoch) * 1000) / 10,
    tps: Math.round(1800 + u(`solnet:tps${minute}`) * 2400),
    validatorCount: Math.round(1400 + u(`solnet:val${minute}`) * 100),
    totalStakeSol: Math.round(385_000_000 + u(`solnet:stake${minute}`) * 10_000_000),
    circulatingSupplySol: 468_000_000,
    totalSupplySol: 586_000_000,
    solPriceUsd: Math.round(solPriceUsd * 100) / 100,
    asOf: now,
  };
}

/** Synthetic Solana wallet — holdings seeded on the address (stable), USD moves with SOL. */
export function solanaWalletFor(address: string, now: number): SolanaWallet {
  const solPrice = priceAt(ASSETS[2], now);
  const solBalance = Math.round((0.5 + u(`${address}:sol`) * 250) * 10_000) / 10_000;
  const roster: Array<{ mint: string; symbol: string; price: number | null }> = [
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', price: 1 },
    { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', price: 1 },
    { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', price: Math.round((0.4 + u(`${address}:jup`) * 0.8) * 10_000) / 10_000 },
    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', price: null },
  ];
  const tokens: SolanaTokenHolding[] = roster.map(({ mint, symbol, price }) => {
    const amount = Math.round((5 + u(`${address}:${mint}`) * (symbol === 'BONK' ? 5_000_000 : 5_000)) * 100) / 100;
    return { mint, symbol, amount, valueUsd: price == null ? null : Math.round(price * amount * 100) / 100 };
  });
  const totalValueUsd =
    Math.round((solBalance * solPrice + tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0)) * 100) / 100;
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    address,
    solBalance,
    tokens,
    totalValueUsd,
    asOf: now,
  };
}

const SOLANA_TRENDING_ROSTER: Array<{ symbol: string; price: number; dex: string }> = [
  { symbol: 'WIF', price: 2.4, dex: 'Raydium' },
  { symbol: 'BONK', price: 0.000023, dex: 'Orca' },
  { symbol: 'JUP', price: 0.85, dex: 'Meteora' },
  { symbol: 'JTO', price: 3.1, dex: 'Raydium' },
  { symbol: 'PYTH', price: 0.42, dex: 'Orca' },
  { symbol: 'RAY', price: 4.6, dex: 'Raydium' },
  { symbol: 'POPCAT', price: 1.3, dex: 'Raydium' },
  { symbol: 'MEW', price: 0.008, dex: 'Meteora' },
  { symbol: 'PENGU', price: 0.03, dex: 'Orca' },
  { symbol: 'W', price: 0.28, dex: 'Meteora' },
  { symbol: 'RENDER', price: 7.2, dex: 'Orca' },
  { symbol: 'PNUT', price: 0.9, dex: 'Raydium' },
];

const SOLANA_DEX_VENUES: Array<{ dex: string; feeBps: number; quote: string }> = [
  { dex: 'Raydium', feeBps: 25, quote: 'SOL' },
  { dex: 'Orca', feeBps: 30, quote: 'USDC' },
  { dex: 'Meteora', feeBps: 20, quote: 'USDC' },
  { dex: 'Phoenix', feeBps: 2, quote: 'USDC' },
  { dex: 'Lifinity', feeBps: 10, quote: 'SOL' },
];

/** Synthetic trending Solana tokens — moves each minute, sorted by 24h volume. */
export function solanaTrendingFor(now: number): SolanaTrending {
  const minute = Math.floor(now / 60_000);
  const tokens: SolanaTrendingToken[] = SOLANA_TRENDING_ROSTER.map(({ symbol, price, dex }) => {
    const px = price * (1 + (u(`${symbol}:sp${minute}`) - 0.5) * 0.08);
    const liquidityUsd = 25_000_000 * (0.1 + u(`${symbol}:sl${minute}`));
    const quote = dex === 'Raydium' ? 'SOL' : 'USDC';
    return {
      symbol,
      pair: `${symbol}/${quote}`,
      dex,
      priceUsd: px,
      change24hPct: (u(`${symbol}:sc${minute}`) - 0.45) * 40,
      volume24hUsd: liquidityUsd * (0.2 + u(`${symbol}:sv${minute}`) * 3),
      liquidityUsd,
    };
  });
  tokens.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  return { source: DEMO_SOURCE, provenance: 'synthetic', note: NOTE, tokens, asOf: now };
}

/** Synthetic Solana DEX pools for an asset (Solana venues, SOL/USDC quotes). */
export function solanaDexPoolsFor(symbol: string, now: number): DexPools {
  const asset = assetFor(symbol);
  if (!asset) {
    return { symbol: symbol.toUpperCase(), provenance: 'unavailable', note: 'Unknown demo asset.', pools: [] };
  }
  const price = priceAt(asset, now);
  const pools = SOLANA_DEX_VENUES.map(({ dex, feeBps, quote }, i) => ({
    dex,
    pair: `${asset.base}/${quote}`,
    priceUsd: price * (1 + (u(`${asset.base}:sdx${i}`) - 0.5) * 0.003),
    liquidityUsd: 30_000_000 * (0.1 + u(`${asset.base}:sdl${i}`)) * (asset.price > 1000 ? 3 : 1),
    volume24hUsd: 12_000_000 * (0.1 + u(`${asset.base}:sdv${i}`)),
    feeBps,
  }));
  return { symbol: asset.base, provenance: 'synthetic', note: NOTE, pools };
}

/** Synthetic Solana validator leaderboard — stable per hour, ranked by stake. */
export function solanaValidatorsFor(now: number): SolanaValidators {
  const hour = Math.floor(now / 3_600_000);
  const count = 30;
  const raw = Array.from({ length: count }, (_, i) => ({
    stake: Math.floor((0.4 + u(`solval:${i}:${hour}`) * 0.6) * 4_000_000 * Math.pow(0.9, i)),
    commissionPct: Math.round(u(`solval:c${i}:${hour}`) * 10),
    delinquent: i > 26 && u(`solval:d${i}:${hour}`) > 0.5,
  }));
  const totalStakeSol = raw.reduce((s, v) => s + v.stake, 0);
  const validators: SolanaValidator[] = raw
    .map((v, i) => ({
      votePubkey: `Vote${i}1111111111111111111111111111111111111`,
      identity: `Node${i}…${(1000 + i).toString(36)}`,
      activatedStakeSol: v.stake,
      commissionPct: v.commissionPct,
      stakeSharePct: Math.round((v.stake / totalStakeSol) * 10000) / 100,
      delinquent: v.delinquent,
      lastVoteSlot: 296_000_000 + i,
    }))
    .sort((a, b) => (b.activatedStakeSol ?? 0) - (a.activatedStakeSol ?? 0));
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    totalStakeSol,
    validatorCount: validators.filter((v) => !v.delinquent).length,
    delinquentCount: validators.filter((v) => v.delinquent).length,
    validators,
    asOf: now,
  };
}

/** Synthetic Solana native staking economics. */
export function solanaStakingFor(now: number): SolanaStaking {
  const hour = Math.floor(now / 3_600_000);
  const inflation = 0.044 + u(`solstake:i${hour}`) * 0.004;
  const stakedRatio = 0.63 + u(`solstake:s${hour}`) * 0.04;
  const epochsPerYear = 182;
  const nominal = inflation / stakedRatio;
  const real = (1 + nominal / epochsPerYear) ** epochsPerYear - 1;
  const pct = (x: number): number => Math.round(x * 1000) / 10;
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    inflationPct: pct(inflation),
    stakedRatioPct: pct(stakedRatio),
    nominalApyPct: pct(nominal),
    realApyPct: pct(real),
    epochsPerYear,
    asOf: now,
  };
}

/** Well-known mints the demo token explorer + swap quotes recognize. */
const DEMO_MINTS: Record<string, { symbol: string; decimals: number }> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', decimals: 5 },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', decimals: 6 },
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: { symbol: 'JTO', decimals: 9 },
};
const SYMBOL_TO_MINT: Record<string, string> = Object.fromEntries(
  Object.entries(DEMO_MINTS).map(([mint, v]) => [v.symbol, mint]),
);
/**
 * A small USD basis for synthetic swap quotes (the six swappable demo tokens).
 * SOL is derived from the same ASSETS entry that drives every other SOL price in
 * the demo, so the swap panel's notional math can't drift from the ~$158 SOL
 * shown everywhere else (a hand-copied 152 disagreed here before). The memecoins
 * (BONK/JUP/JTO) aren't in the CEX universe, so they carry their own basis.
 */
const SWAP_BASIS_USD: Record<string, number> = {
  SOL: ASSETS.find((a) => a.base === 'SOL')?.price ?? 158,
  USDC: 1,
  USDT: 1,
  BONK: 0.000025,
  JUP: 0.9,
  JTO: 3.1,
};

/** Synthetic SPL token (mint) snapshot — supply + authorities, seeded on the mint. */
export function solanaTokenFor(mint: string, now: number): SolanaTokenInfo {
  const known = DEMO_MINTS[mint];
  const symbol = known?.symbol ?? (mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint);
  const decimals = known?.decimals ?? 6;
  const mintActive = u(`spl:m${mint}`) > 0.5;
  const freezeActive = u(`spl:f${mint}`) > 0.6;
  const price = symbol === 'USDC' || symbol === 'USDT' ? 1 : symbol === 'SOL' ? Math.round(priceAt(ASSETS[2], now) * 100) / 100 : null;
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    mint,
    symbol,
    program: 'spl-token',
    decimals,
    supply: Math.floor((1 + u(`spl:s${mint}`) * 899) * 1_000_000),
    mintAuthority: mintActive ? 'Mint1111111111111111111111111111111111111' : null,
    mintAuthorityActive: mintActive,
    freezeAuthority: freezeActive ? 'Freeze11111111111111111111111111111111111' : null,
    freezeAuthorityActive: freezeActive,
    priceUsd: price,
    asOf: now,
  };
}

/** Synthetic Jupiter swap quote — read-only price estimate; impact grows with notional. */
export function solanaQuoteFor(input: string, output: string, amount: number, now: number): SolanaSwapQuote {
  const inSym = input.toUpperCase();
  const outSym = output.toUpperCase();
  const bad = (note: string): SolanaSwapQuote => ({
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note,
    inputSymbol: inSym,
    outputSymbol: outSym,
    inputMint: SYMBOL_TO_MINT[inSym] ?? '',
    outputMint: SYMBOL_TO_MINT[outSym] ?? '',
    inAmount: null,
    outAmount: null,
    price: null,
    priceImpactPct: null,
    slippageBps: null,
    route: [],
    asOf: now,
  });
  if (SWAP_BASIS_USD[inSym] == null || SWAP_BASIS_USD[outSym] == null)
    return bad('Synthetic quotes cover a known set (SOL, USDC, USDT, BONK, JUP, JTO).');
  if (inSym === outSym) return bad('Pick two different tokens to quote a swap.');
  if (!(amount > 0)) return bad('Enter a positive input amount to quote.');
  const minute = Math.floor(now / 60_000);
  const notionalUsd = amount * SWAP_BASIS_USD[inSym];
  const impactPct = Math.min(8, Math.sqrt(notionalUsd / 50_000) * 0.5) * (1 + u(`sjup:${inSym}${outSym}${minute}`) * 0.1);
  const feePct = 0.25;
  const out = ((amount * SWAP_BASIS_USD[inSym]) / SWAP_BASIS_USD[outSym]) * (1 - impactPct / 100 - feePct / 100);
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    inputSymbol: inSym,
    outputSymbol: outSym,
    inputMint: SYMBOL_TO_MINT[inSym] ?? '',
    outputMint: SYMBOL_TO_MINT[outSym] ?? '',
    inAmount: amount,
    outAmount: Math.round(out * 1e6) / 1e6,
    price: Math.round((out / amount) * 1e8) / 1e8,
    priceImpactPct: Math.round(impactPct * 1000) / 1000,
    slippageBps: 50,
    route: [
      { dex: 'Orca', percent: 60 },
      { dex: 'Raydium', percent: 40 },
    ],
    asOf: now,
  };
}

/** Synthetic Solana ecosystem overview — SOL price header + a top-tokens roll-up. */
export function solanaMarketFor(now: number): SolanaMarket {
  const tokens: SolanaMarketToken[] = solanaTrendingFor(now).tokens.map((t) => ({
    symbol: t.symbol,
    priceUsd: t.priceUsd,
    change24hPct: t.change24hPct,
    volume24hUsd: t.volume24hUsd,
    liquidityUsd: t.liquidityUsd,
  }));
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    solPriceUsd: Math.round(priceAt(ASSETS[2], now) * 100) / 100,
    totalVolume24hUsd: Math.round(tokens.reduce((s, t) => s + (t.volume24hUsd ?? 0), 0)),
    totalLiquidityUsd: Math.round(tokens.reduce((s, t) => s + (t.liquidityUsd ?? 0), 0)),
    tokenCount: tokens.length,
    tokens,
    asOf: now,
  };
}

export function balancesFor(now: number): Balances {
  const btc = priceAt(ASSETS[0], now);
  const eth = priceAt(ASSETS[1], now);
  const sol = priceAt(ASSETS[2], now);
  const rows = [
    { asset: 'USDT', free: 12_400, used: 2_600, total: 15_000, valueUsd: 15_000 },
    { asset: 'BTC', free: 0.32, used: 0.05, total: 0.37, valueUsd: 0.37 * btc },
    { asset: 'ETH', free: 4.1, used: 0, total: 4.1, valueUsd: 4.1 * eth },
    { asset: 'SOL', free: 85, used: 15, total: 100, valueUsd: 100 * sol },
  ];
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    totalValueUsd: rows.reduce((s, r) => s + (r.valueUsd ?? 0), 0),
    balances: rows,
    asOf: now,
  };
}

export function openOrdersFor(now: number): OpenOrders {
  const btc = priceAt(ASSETS[0], now);
  const sol = priceAt(ASSETS[2], now);
  const orders = [
    {
      id: 'demo-1001',
      symbol: `BTC/${QUOTE_CCY}`,
      side: 'buy' as const,
      type: 'limit',
      price: btc * 0.985,
      amount: 0.05,
      filled: 0,
      remaining: 0.05,
      value: btc * 0.985 * 0.05,
      timestamp: now - 3_600_000 * 5,
      status: 'open',
    },
    {
      id: 'demo-1002',
      symbol: `SOL/${QUOTE_CCY}`,
      side: 'sell' as const,
      type: 'limit',
      price: sol * 1.04,
      amount: 15,
      filled: 6,
      remaining: 9,
      value: sol * 1.04 * 15,
      timestamp: now - 3_600_000 * 2,
      status: 'open',
    },
  ];
  return { source: DEMO_SOURCE, provenance: 'synthetic', note: NOTE, orders, asOf: now };
}

export function positionsFor(now: number): AccountPositions {
  const eth = priceAt(ASSETS[1], now);
  const sol = priceAt(ASSETS[2], now);
  const mk = (symbol: string, side: 'long' | 'short', contracts: number, entry: number, mark: number, lev: number) => {
    const pnl = (side === 'long' ? mark - entry : entry - mark) * contracts;
    return {
      symbol,
      side,
      contracts,
      notionalUsd: mark * contracts,
      entryPrice: entry,
      markPrice: mark,
      unrealizedPnlUsd: pnl,
      pnlPct: ((side === 'long' ? mark / entry : entry / mark) - 1) * 100 * lev,
      liquidationPrice: side === 'long' ? entry * (1 - 0.9 / lev) : entry * (1 + 0.9 / lev),
      leverage: lev,
    };
  };
  const positions = [
    mk(`ETH/${QUOTE_CCY}:${QUOTE_CCY}`, 'long', 2.5, eth * 0.96, eth, 3),
    mk(`SOL/${QUOTE_CCY}:${QUOTE_CCY}`, 'short', 40, sol * 1.02, sol, 2),
  ];
  return {
    source: DEMO_SOURCE,
    provenance: 'synthetic',
    note: NOTE,
    totalUnrealizedPnlUsd: positions.reduce((s, p) => s + (p.unrealizedPnlUsd ?? 0), 0),
    positions,
    asOf: now,
  };
}

export function fillsFor(now: number, symbol?: string): AccountFills {
  const eth = priceAt(ASSETS[1], now);
  const sol = priceAt(ASSETS[2], now);
  const fills = [
    { sym: `ETH/${QUOTE_CCY}`, side: 'buy' as const, price: eth * 0.96, amount: 2.5, ago: 26, mk: 'maker' },
    { sym: `SOL/${QUOTE_CCY}`, side: 'sell' as const, price: sol * 1.02, amount: 40, ago: 20, mk: 'taker' },
    { sym: `SOL/${QUOTE_CCY}`, side: 'sell' as const, price: sol * 1.035, amount: 6, ago: 2, mk: 'maker' },
  ].map((f, i) => ({
    id: `demo-fill-${i + 1}`,
    orderId: `demo-10${i}`,
    symbol: f.sym,
    side: f.side,
    price: f.price,
    amount: f.amount,
    cost: f.price * f.amount,
    fee: f.price * f.amount * (f.mk === 'maker' ? 0.0002 : 0.0005),
    feeCurrency: QUOTE_CCY,
    takerOrMaker: f.mk,
    timestamp: now - f.ago * 3_600_000,
  }));
  // The server's /api/fills honours ?symbol= (getFills(symbol)); mirror it so a
  // symbol-scoped FILLS/XQL panel doesn't show other symbols' fills in the demo.
  const want = symbol?.trim().toUpperCase();
  const scoped = want ? fills.filter((f) => f.symbol === want) : fills;
  return { source: DEMO_SOURCE, provenance: 'synthetic', note: NOTE, fills: scoped, asOf: now };
}
