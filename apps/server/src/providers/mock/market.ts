import type {
  Candle,
  FundingHistoryPoint,
  HistoryResponse,
  NewsItem,
  OrderBook,
  OrderBookLevel,
  Quote,
  ScreenerRow,
  SearchResult,
  VenueQuote,
} from '@midas/shared';
import type { HistoryOptions, ScreenerOptions } from '../types';
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
} from '../util';
import {
  COMPARE_VENUES,
  HEADLINE_TEMPLATES,
  MARKET_HEADLINES,
  NEWS_PUBLISHERS,
  ROSTER,
  resolveEntry,
} from './fixtures';
import { buildQuote } from './quote';

export async function mockQuote(symbol: string): Promise<Quote> {
  return buildQuote(resolveEntry(symbol));
}

export async function mockQuotes(symbols: string[]): Promise<Quote[]> {
  return symbols.map((symbol) => buildQuote(resolveEntry(symbol)));
}

export async function mockOrderBook(symbol: string, depth = 25): Promise<OrderBook> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
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

export async function mockExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
  const entry = resolveEntry(symbol);
  const mid = buildQuote(entry).price;
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

export async function mockFundingHistory(symbol: string, limit: number): Promise<FundingHistoryPoint[]> {
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

export async function mockScreen(opts: ScreenerOptions): Promise<ScreenerRow[]> {
  const quote = (opts.quote ?? 'USDT').toUpperCase();
  const rows: ScreenerRow[] = ROSTER.filter(
    (e) => e.type === 'CRYPTOCURRENCY' && e.symbol.includes('/') && e.symbol.split('/')[1] === quote,
  ).map((e) => {
    const q = buildQuote(e);
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

export async function mockHistory(symbol: string, opts: HistoryOptions): Promise<HistoryResponse> {
  const entry = resolveEntry(symbol);
  const { interval, range } = opts;
  const stepSeconds = INTERVAL_SECONDS[interval];
  const rangeSeconds = RANGE_SECONDS[range];
  const count = clamp(Math.floor(rangeSeconds / stepSeconds), 2, 1200);

  // Anchor the final candle to the symbol's current quote so the chart and
  // the quote modules agree on "the price right now".
  const quote = buildQuote(entry);
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

export async function mockSearch(query: string): Promise<SearchResult[]> {
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

export async function mockNews(symbol?: string): Promise<NewsItem[]> {
  const dayBucket = Math.floor(Date.now() / 86_400_000);
  const count = 12;

  if (!symbol) {
    const rng = seeded('market', dayBucket);
    return Array.from({ length: count }, (_, i) => {
      const title = MARKET_HEADLINES[Math.floor(rng() * MARKET_HEADLINES.length)];
      return buildNewsItem(`market-${dayBucket}-${i}`, title, [], rng, i);
    });
  }

  const entry = resolveEntry(symbol);
  const rng = seeded(entry.symbol, 'news', dayBucket);
  return Array.from({ length: count }, (_, i) => {
    const template = HEADLINE_TEMPLATES[Math.floor(rng() * HEADLINE_TEMPLATES.length)];
    const title = template
      .replace('{sym}', entry.symbol)
      .replace('{name}', entry.name.replace(/,?\s+(Inc\.|Corporation|Corp\.|Company|Incorporated|Holdings Corp\.).*$/, ''));
    return buildNewsItem(`${entry.symbol}-${dayBucket}-${i}`, title, [entry.symbol], rng, i);
  });
}

function buildNewsItem(
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
