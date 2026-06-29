import type {
  Candle,
  DerivativesInfo,
  FundingHistoryPoint,
  HistoryResponse,
  LiquidationsProvenance,
  MarketState,
  NewsItem,
  OrderBook,
  OrderBookLevel,
  Quote,
  ScreenerRow,
  SearchResult,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import {
  INTERVAL_SECONDS,
  RANGE_SECONDS,
  clamp,
  gaussian,
  hashString,
  round,
  seeded,
  sortScreener,
  uniform,
  usMarketState,
} from './util';

interface RosterEntry {
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
const ROSTER: RosterEntry[] = [
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

const ROSTER_BY_SYMBOL = new Map(ROSTER.map((entry) => [entry.symbol, entry]));

const COMPARE_VENUES = ['Binance', 'Coinbase', 'Kraken', 'Bitfinex', 'OKX', 'KuCoin'];

const NEWS_PUBLISHERS = [
  'Reuters',
  'Bloomberg',
  'The Wall Street Journal',
  'Financial Times',
  'CNBC',
  'MarketWatch',
  'Barron’s',
  'Yahoo Finance',
];

const HEADLINE_TEMPLATES = [
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

const MARKET_HEADLINES = [
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
function resolveEntry(rawSymbol: string): RosterEntry {
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

/**
 * Deterministic synthetic data provider. Prices wiggle minute-to-minute (so the
 * terminal feels alive) but are stable within a given minute, and historical
 * series are fully reproducible for a (symbol, interval, range) triple.
 */
export class MockProvider implements DataProvider {
  readonly name = 'mock';
  readonly live = false;

  async getQuote(symbol: string): Promise<Quote> {
    return this.buildQuote(resolveEntry(symbol));
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    return symbols.map((symbol) => this.buildQuote(resolveEntry(symbol)));
  }

  async getOrderBook(symbol: string, depth = 25): Promise<OrderBook> {
    const entry = resolveEntry(symbol);
    const mid = this.buildQuote(entry).price;
    // Wiggle the book each minute so the DOM feels alive but is stable within a minute.
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const rng = seeded(entry.symbol, minuteBucket, 'book');

    const tick = Math.max(mid * 0.0002, mid < 1 ? 0.00001 : 0.01);
    const halfSpread = tick * uniform(rng, 0.5, 1.5);
    const sizeBase = mid > 0 ? clamp(50_000 / mid, 0.5, 5_000) : 1;

    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    for (let i = 0; i < depth; i++) {
      const bidPrice = mid - halfSpread - i * tick * (1 + uniform(rng, 0, 0.4));
      const askPrice = mid + halfSpread + i * tick * (1 + uniform(rng, 0, 0.4));
      const grow = 1 + i * 0.12;
      bids.push({ price: round(bidPrice, 6), amount: round(sizeBase * uniform(rng, 0.2, 1.8) * grow, 4) });
      asks.push({ price: round(askPrice, 6), amount: round(sizeBase * uniform(rng, 0.2, 1.8) * grow, 4) });
    }
    return { symbol: entry.symbol, bids, asks, timestamp: Date.now() };
  }

  async getExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
    const entry = resolveEntry(symbol);
    const mid = this.buildQuote(entry).price;
    const minuteBucket = Math.floor(Date.now() / 60_000);
    return COMPARE_VENUES.map((venue) => {
      const rng = seeded(entry.symbol, venue, minuteBucket, 'venue');
      // Each venue prices slightly differently (a realistic cross-exchange basis).
      const price = round(mid * (1 + uniform(rng, -0.0015, 0.0015)), 6);
      const spread = price * uniform(rng, 0.0001, 0.0006);
      return {
        exchange: venue,
        price,
        bid: round(price - spread / 2, 6),
        ask: round(price + spread / 2, 6),
        changePercent: round(gaussian(rng) * 1.2, 2),
        volume: Math.floor(uniform(rng, 0.3, 1.5) * (mid > 1000 ? 5_000 : 5_000_000)),
        timestamp: Date.now(),
      };
    });
  }

  async getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
    const entry = resolveEntry(symbol);
    const mid = this.buildQuote(entry).price;
    const eightHour = Math.floor(Date.now() / (8 * 3_600_000));
    const nextFunding = (eightHour + 1) * (8 * 3_600_000);
    return COMPARE_VENUES.map((venue) => {
      // Each venue funds slightly differently → a realistic cross-venue spread.
      const rng = seeded(entry.symbol, venue, eightHour, 'venuederiv');
      const oiBase = Math.floor(uniform(rng, 1_000, 250_000) * (mid > 1000 ? 1 : 1000));
      return {
        exchange: venue,
        fundingRate: round(gaussian(rng) * 0.0001, 6),
        nextFundingTime: nextFunding,
        markPrice: round(mid * (1 + gaussian(rng) * 0.0003), 6),
        openInterestValue: Math.floor(oiBase * mid),
        timestamp: Date.now(),
      };
    });
  }

  async getDerivatives(symbol: string): Promise<DerivativesInfo> {
    const entry = resolveEntry(symbol);
    const mid = this.buildQuote(entry).price;
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const rng = seeded(entry.symbol, hourBucket, 'deriv');
    const oiBase = Math.floor(uniform(rng, 1_000, 250_000) * (mid > 1000 ? 1 : 1000));
    // Next funding at the next 8-hour boundary.
    const nextFunding = (Math.floor(Date.now() / (8 * 3_600_000)) + 1) * (8 * 3_600_000);

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
      nextFundingTime: nextFunding,
      markPrice: round(mid * (1 + gaussian(rng) * 0.0003), 6),
      indexPrice: mid,
      openInterest: oiBase,
      openInterestValue: Math.floor(oiBase * mid),
      recentLiquidations,
      timestamp: Date.now(),
    };
  }

  liquidationsProvenance(): LiquidationsProvenance {
    return {
      source: 'mock',
      available: true,
      note: 'Synthetic liquidations for offline/demo use — not real market data.',
    };
  }

  async getFundingHistory(symbol: string, limit: number): Promise<FundingHistoryPoint[]> {
    const entry = resolveEntry(symbol);
    const interval = 8 * 3_600_000; // 8h settlements
    const n = Math.min(Math.max(1, Math.floor(limit)), 500);
    const latest = Math.floor(Date.now() / interval) * interval;
    const out: FundingHistoryPoint[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const time = latest - i * interval;
      const rng = seeded(entry.symbol, Math.floor(time / interval), 'fundhist');
      out.push({ time, fundingRate: round(gaussian(rng) * 0.0001, 6) });
    }
    return out;
  }

  async screen(opts: ScreenerOptions): Promise<ScreenerRow[]> {
    const quote = (opts.quote ?? 'USDT').toUpperCase();
    const rows: ScreenerRow[] = ROSTER.filter(
      (e) => e.type === 'CRYPTOCURRENCY' && e.symbol.includes('/') && e.symbol.split('/')[1] === quote,
    ).map((e) => {
      const q = this.buildQuote(e);
      return {
        symbol: e.symbol,
        name: e.name,
        price: q.price,
        changePercent: q.changePercent,
        volume: q.volume,
        quoteVolume: q.volume != null ? Math.floor(q.volume * q.price) : null,
      };
    });
    return sortScreener(rows, opts.sort).slice(0, opts.limit ?? 50);
  }

  async getHistory(symbol: string, opts: HistoryOptions): Promise<HistoryResponse> {
    const entry = resolveEntry(symbol);
    const { interval, range } = opts;
    const stepSeconds = INTERVAL_SECONDS[interval];
    const rangeSeconds = RANGE_SECONDS[range];
    const count = clamp(Math.floor(rangeSeconds / stepSeconds), 2, 1200);

    // Anchor the final candle to the symbol's current quote so the chart and
    // the quote modules agree on "the price right now".
    const quote = this.buildQuote(entry);
    const rng = seeded(entry.symbol, interval, range, 'history');
    const volatility = 0.012 + uniform(rng, 0, 0.01); // per-step sigma
    const nowSec = Math.floor(Date.now() / 1000);
    const alignedNow = nowSec - (nowSec % stepSeconds);

    // Build a backward random walk from the current price.
    const closes = new Array<number>(count);
    closes[count - 1] = quote.price;
    for (let i = count - 2; i >= 0; i--) {
      const drift = gaussian(rng) * volatility;
      closes[i] = closes[i + 1] / (1 + drift);
    }

    const candles: Candle[] = [];
    for (let i = 0; i < count; i++) {
      const time = alignedNow - (count - 1 - i) * stepSeconds;
      const close = closes[i];
      const open = i === 0 ? close / (1 + gaussian(rng) * volatility * 0.5) : closes[i - 1];
      const wick = Math.abs(gaussian(rng)) * volatility;
      const high = Math.max(open, close) * (1 + wick);
      const low = Math.min(open, close) * (1 - wick);
      const volume = Math.floor(uniform(rng, 0.4, 1.6) * 5_000_000);
      candles.push({
        time,
        open: round(open),
        high: round(high),
        low: round(low),
        close: round(close),
        volume,
      });
    }

    return {
      symbol: entry.symbol,
      interval,
      range,
      currency: entry.currency,
      candles,
    };
  }

  async search(query: string): Promise<SearchResult[]> {
    const q = query.trim().toUpperCase();
    if (!q) return [];

    const matches = ROSTER.filter(
      (entry) =>
        entry.symbol.includes(q) || entry.name.toUpperCase().includes(q),
    ).slice(0, 15);

    if (matches.length === 0) {
      const entry = resolveEntry(q);
      return [
        {
          symbol: entry.symbol,
          name: entry.name,
          exchange: entry.exchange,
          type: entry.type,
        },
      ];
    }

    return matches.map((entry) => ({
      symbol: entry.symbol,
      name: entry.name,
      exchange: entry.exchange,
      type: entry.type,
    }));
  }

  async getNews(symbol?: string): Promise<NewsItem[]> {
    const dayBucket = Math.floor(Date.now() / 86_400_000);
    const count = 12;

    if (!symbol) {
      const rng = seeded('market', dayBucket);
      return Array.from({ length: count }, (_, i) => {
        const title = MARKET_HEADLINES[Math.floor(rng() * MARKET_HEADLINES.length)];
        return this.buildNewsItem(`market-${dayBucket}-${i}`, title, [], rng, i);
      });
    }

    const entry = resolveEntry(symbol);
    const rng = seeded(entry.symbol, 'news', dayBucket);
    return Array.from({ length: count }, (_, i) => {
      const template = HEADLINE_TEMPLATES[Math.floor(rng() * HEADLINE_TEMPLATES.length)];
      const title = template
        .replace('{sym}', entry.symbol)
        .replace('{name}', entry.name.replace(/,?\s+(Inc\.|Corporation|Corp\.|Company|Incorporated|Holdings Corp\.).*$/, ''));
      return this.buildNewsItem(`${entry.symbol}-${dayBucket}-${i}`, title, [entry.symbol], rng, i);
    });
  }

  // -- internals -----------------------------------------------------------

  private buildQuote(entry: RosterEntry): Quote {
    const now = Date.now();
    const dayBucket = Math.floor(now / 86_400_000);
    const minuteBucket = Math.floor(now / 60_000);

    // Day-stable components (previous close, 52wk band, volume baseline).
    const dayRng = seeded(entry.symbol, dayBucket, 'day');
    const previousClose = round(entry.base * (1 + gaussian(dayRng) * 0.01));
    const fiftyTwoWeekHigh = round(entry.base * uniform(dayRng, 1.08, 1.4));
    const fiftyTwoWeekLow = round(entry.base * uniform(dayRng, 0.6, 0.92));
    const baseVolume = Math.floor(uniform(dayRng, 0.5, 1.5) * 30_000_000);
    const shares = Math.floor(uniform(dayRng, 0.4, 8) * 1_000_000_000);
    const open = round(previousClose * (1 + gaussian(dayRng) * 0.004));

    // Minute-stable component (the live wiggle).
    const minRng = seeded(entry.symbol, minuteBucket, 'min');
    const changePercent = clamp(gaussian(minRng) * 1.4, -8, 8);
    const price = round(previousClose * (1 + changePercent / 100));
    const change = round(price - previousClose);

    const dayHigh = round(Math.max(open, price) * (1 + Math.abs(gaussian(dayRng)) * 0.006));
    const dayLow = round(Math.min(open, price) * (1 - Math.abs(gaussian(dayRng)) * 0.006));

    const state: MarketState = entry.type === 'CRYPTOCURRENCY' ? 'REGULAR' : usMarketState(now);

    return {
      symbol: entry.symbol,
      name: entry.name,
      currency: entry.currency,
      exchange: entry.exchange,
      marketState: state,
      price,
      previousClose,
      open,
      dayHigh,
      dayLow,
      change,
      changePercent: round(previousClose === 0 ? 0 : (change / previousClose) * 100),
      volume: Math.floor(baseVolume * uniform(minRng, 0.6, 1.1)),
      marketCap: entry.type === 'INDEX' ? null : Math.floor(price * shares),
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow,
      asOf: now,
    };
  }

  private buildNewsItem(
    id: string,
    title: string,
    relatedSymbols: string[],
    rng: () => number,
    index: number,
  ): NewsItem {
    const publisher = NEWS_PUBLISHERS[Math.floor(rng() * NEWS_PUBLISHERS.length)];
    // Spread headlines across the last ~72 hours, newest first.
    const ageMinutes = Math.floor(index * 220 + rng() * 200);
    const slug = String(hashString(id).toString(36));
    return {
      id,
      title,
      publisher,
      link: `https://example.com/news/${slug}`,
      publishedAt: Date.now() - ageMinutes * 60_000,
      relatedSymbols,
      summary: 'Synthetic headline generated by the Midas mock data provider for offline development.',
    };
  }
}
