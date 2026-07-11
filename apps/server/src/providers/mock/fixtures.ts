import { round, seeded, uniform } from '../util';

/** Canonical provider name for every synthetic snapshot's `source` field. */
export const MOCK_SOURCE = 'mock';

export interface RosterEntry {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  /** Reference price the synthetic series anchors around. */
  base: number;
  currency: string;
}

/**
 * A roster of well-known securities so search, watchlists and quotes feel real.
 * Any symbol not listed here is synthesized on the fly from its hash, so the
 * terminal still responds to anything the user types.
 */
export const ROSTER: RosterEntry[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY', base: 212, currency: 'USD' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', type: 'EQUITY', base: 444, currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A', exchange: 'NASDAQ', type: 'EQUITY', base: 178, currency: 'USD' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NASDAQ', type: 'EQUITY', base: 186, currency: 'USD' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'EQUITY', base: 126, currency: 'USD' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', exchange: 'NASDAQ', type: 'EQUITY', base: 503, currency: 'USD' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', type: 'EQUITY', base: 185, currency: 'USD' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', exchange: 'NASDAQ', type: 'EQUITY', base: 678, currency: 'USD' },
  { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', exchange: 'NASDAQ', type: 'EQUITY', base: 162, currency: 'USD' },
  { symbol: 'INTC', name: 'Intel Corporation', exchange: 'NASDAQ', type: 'EQUITY', base: 31, currency: 'USD' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', type: 'EQUITY', base: 205, currency: 'USD' },
  { symbol: 'BAC', name: 'Bank of America Corporation', exchange: 'NYSE', type: 'EQUITY', base: 40, currency: 'USD' },
  { symbol: 'GS', name: 'The Goldman Sachs Group, Inc.', exchange: 'NYSE', type: 'EQUITY', base: 478, currency: 'USD' },
  { symbol: 'V', name: 'Visa Inc.', exchange: 'NYSE', type: 'EQUITY', base: 273, currency: 'USD' },
  { symbol: 'MA', name: 'Mastercard Incorporated', exchange: 'NYSE', type: 'EQUITY', base: 446, currency: 'USD' },
  { symbol: 'DIS', name: 'The Walt Disney Company', exchange: 'NYSE', type: 'EQUITY', base: 101, currency: 'USD' },
  { symbol: 'KO', name: 'The Coca-Cola Company', exchange: 'NYSE', type: 'EQUITY', base: 63, currency: 'USD' },
  { symbol: 'PEP', name: 'PepsiCo, Inc.', exchange: 'NASDAQ', type: 'EQUITY', base: 168, currency: 'USD' },
  { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', type: 'EQUITY', base: 67, currency: 'USD' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', exchange: 'NYSE', type: 'EQUITY', base: 114, currency: 'USD' },
  { symbol: 'CVX', name: 'Chevron Corporation', exchange: 'NYSE', type: 'EQUITY', base: 156, currency: 'USD' },
  { symbol: 'BA', name: 'The Boeing Company', exchange: 'NYSE', type: 'EQUITY', base: 182, currency: 'USD' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', exchange: 'NYSE', type: 'EQUITY', base: 338, currency: 'USD' },
  { symbol: 'GE', name: 'General Electric Company', exchange: 'NYSE', type: 'EQUITY', base: 165, currency: 'USD' },
  { symbol: 'PFE', name: 'Pfizer Inc.', exchange: 'NYSE', type: 'EQUITY', base: 28, currency: 'USD' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', exchange: 'NYSE', type: 'EQUITY', base: 148, currency: 'USD' },
  { symbol: 'UNH', name: 'UnitedHealth Group Incorporated', exchange: 'NYSE', type: 'EQUITY', base: 480, currency: 'USD' },
  { symbol: 'HD', name: 'The Home Depot, Inc.', exchange: 'NYSE', type: 'EQUITY', base: 345, currency: 'USD' },
  { symbol: 'CRM', name: 'Salesforce, Inc.', exchange: 'NYSE', type: 'EQUITY', base: 248, currency: 'USD' },
  { symbol: 'ORCL', name: 'Oracle Corporation', exchange: 'NYSE', type: 'EQUITY', base: 140, currency: 'USD' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'NYSEARCA', type: 'ETF', base: 545, currency: 'USD' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', type: 'ETF', base: 480, currency: 'USD' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', exchange: 'NYSEARCA', type: 'ETF', base: 402, currency: 'USD' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', exchange: 'NYSEARCA', type: 'ETF', base: 205, currency: 'USD' },
  { symbol: '^GSPC', name: 'S&P 500 Index', exchange: 'SNP', type: 'INDEX', base: 5460, currency: 'USD' },
  { symbol: '^IXIC', name: 'NASDAQ Composite', exchange: 'NASDAQ', type: 'INDEX', base: 17700, currency: 'USD' },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average', exchange: 'DJI', type: 'INDEX', base: 39100, currency: 'USD' },
  { symbol: 'BTC-USD', name: 'Bitcoin USD', exchange: 'CCC', type: 'CRYPTOCURRENCY', base: 64000, currency: 'USD' },
  { symbol: 'ETH-USD', name: 'Ethereum USD', exchange: 'CCC', type: 'CRYPTOCURRENCY', base: 3400, currency: 'USD' },
  // Crypto pairs in CCXT unified form (BASE/QUOTE) — Midas's native asset class.
  { symbol: 'BTC/USDT', name: 'Bitcoin', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 64000, currency: 'USDT' },
  { symbol: 'ETH/USDT', name: 'Ethereum', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 3400, currency: 'USDT' },
  { symbol: 'SOL/USDT', name: 'Solana', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 152, currency: 'USDT' },
  { symbol: 'BNB/USDT', name: 'BNB', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 592, currency: 'USDT' },
  { symbol: 'XRP/USDT', name: 'XRP', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 0.52, currency: 'USDT' },
  { symbol: 'DOGE/USDT', name: 'Dogecoin', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 0.12, currency: 'USDT' },
  { symbol: 'ADA/USDT', name: 'Cardano', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 0.38, currency: 'USDT' },
  { symbol: 'AVAX/USDT', name: 'Avalanche', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 27, currency: 'USDT' },
  { symbol: 'LINK/USDT', name: 'Chainlink', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 14, currency: 'USDT' },
  { symbol: 'MATIC/USDT', name: 'Polygon', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 0.55, currency: 'USDT' },
  { symbol: 'DOT/USDT', name: 'Polkadot', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 6.2, currency: 'USDT' },
  { symbol: 'LTC/USDT', name: 'Litecoin', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 72, currency: 'USDT' },
  { symbol: 'TRX/USDT', name: 'TRON', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 0.13, currency: 'USDT' },
  { symbol: 'ATOM/USDT', name: 'Cosmos', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 7.5, currency: 'USDT' },
  { symbol: 'UNI/USDT', name: 'Uniswap', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 9.1, currency: 'USDT' },
  { symbol: 'ETH/BTC', name: 'Ethereum', exchange: 'BINANCE', type: 'CRYPTOCURRENCY', base: 0.053, currency: 'BTC' },
];

export const ROSTER_BY_SYMBOL = new Map(ROSTER.map((entry) => [entry.symbol, entry]));

export const COMPARE_VENUES = ['Binance', 'Coinbase', 'Kraken', 'Bitfinex', 'OKX', 'KuCoin'];

export const NEWS_PUBLISHERS = [
  'Reuters',
  'Bloomberg',
  'The Wall Street Journal',
  'Financial Times',
  'CNBC',
  'MarketWatch',
  'Barron’s',
  'Yahoo Finance',
];

export const HEADLINE_TEMPLATES = [
  '{name} beats quarterly estimates as revenue climbs',
  '{sym} shares rally after upbeat guidance',
  'Analysts raise price target on {sym} citing margin strength',
  '{name} unveils new product line, shares in focus',
  '{sym} slips as investors weigh macro headwinds',
  'Is {sym} still a buy after its latest run? Analysts weigh in',
  '{name} announces buyback and dividend increase',
  'Options traders position for volatility in {sym}',
  '{sym} downgraded on valuation concerns',
  '{name} expands into new markets amid sector rotation',
  'What {sym}’s latest filing reveals about the road ahead',
  '{sym} among most active names as volume spikes',
];

export const MARKET_HEADLINES = [
  'Stocks mixed as traders await fresh inflation data',
  'Treasury yields edge higher; tech leads early gains',
  'Fed officials signal patience on rate path',
  'Oil steadies as markets digest supply outlook',
  'Dollar firms ahead of key economic releases',
  'Megacap tech drives index futures higher',
  'Volatility gauge eases as risk appetite returns',
  'Earnings season kicks off with banks in focus',
];

/** Resolve a symbol to a roster entry, synthesizing one if unknown. */
export function resolveEntry(rawSymbol: string): RosterEntry {
  const symbol = rawSymbol.toUpperCase();
  const known = ROSTER_BY_SYMBOL.get(symbol);
  if (known) return known;

  // BASE/QUOTE → synthesize a crypto pair so any market the user types works.
  if (symbol.includes('/')) {
    const [base, quote] = symbol.split('/');
    const rng = seeded(symbol, 'crypto');
    return {
      symbol,
      name: `${base} / ${quote}`,
      exchange: 'BINANCE',
      type: 'CRYPTOCURRENCY',
      base: round(uniform(rng, 0.05, 200), 4),
      currency: quote || 'USDT',
    };
  }

  const rng = seeded(symbol, 'entry');
  const base = round(uniform(rng, 12, 480));
  return {
    symbol,
    name: `${symbol} Holdings Corp.`,
    exchange: rng() > 0.5 ? 'NASDAQ' : 'NYSE',
    type: 'EQUITY',
    base,
    currency: 'USD',
  };
}

/** Synthetic DEX pools the mock fabricates per asset (name, fee tier, quote). */
export const DEX_VENUES: Array<{ dex: string; feeBps: number; quote: string }> = [
  { dex: 'Uniswap v3', feeBps: 5, quote: 'USDC' },
  { dex: 'Uniswap v3', feeBps: 30, quote: 'USDC' },
  { dex: 'Curve', feeBps: 4, quote: 'USDT' },
  { dex: 'PancakeSwap', feeBps: 25, quote: 'USDT' },
  { dex: 'Balancer', feeBps: 10, quote: 'DAI' },
];

// Solana-native DEX venues (SOLDEX) and a trending-token roster (STREND) for the
// synthetic offline experience. Live data comes from GeckoTerminal's Solana
// network; these keep the panels useful without a source configured.
export const SOLANA_DEX_VENUES: Array<{ dex: string; feeBps: number; quote: string }> = [
  { dex: 'Raydium', feeBps: 25, quote: 'SOL' },
  { dex: 'Orca', feeBps: 30, quote: 'USDC' },
  { dex: 'Meteora', feeBps: 20, quote: 'USDC' },
  { dex: 'Phoenix', feeBps: 2, quote: 'USDC' },
  { dex: 'Lifinity', feeBps: 10, quote: 'SOL' },
];

export const SOLANA_TRENDING_ROSTER: Array<{ symbol: string; price: number; dex: string }> = [
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
