import type {
  ApiError,
  DerivativesInfo,
  HealthResponse,
  HistoryResponse,
  Interval,
  NewsItem,
  OrderBook,
  Quote,
  Range,
  ScreenerRow,
  SearchResult,
  VenueQuote,
} from '@midas/shared';

/** Optional base URL for the API (e.g. when web and server are on different hosts). */
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as ApiError;
      if (body?.message) message = body.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: (signal?: AbortSignal) => apiGet<HealthResponse>('/api/health', signal),

  quote: (symbol: string, signal?: AbortSignal) =>
    apiGet<Quote>(`/api/quote/${encodeURIComponent(symbol)}`, signal),

  quotes: (symbols: string[], signal?: AbortSignal) =>
    symbols.length === 0
      ? Promise.resolve<Quote[]>([])
      : apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, signal),

  history: (symbol: string, interval: Interval, range: Range, signal?: AbortSignal) =>
    apiGet<HistoryResponse>(
      `/api/history/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
      signal,
    ),

  orderbook: (symbol: string, depth = 25, signal?: AbortSignal) =>
    apiGet<OrderBook>(
      `/api/orderbook/${encodeURIComponent(symbol)}?depth=${depth}`,
      signal,
    ),

  exchangeQuotes: (symbol: string, signal?: AbortSignal) =>
    apiGet<VenueQuote[]>(`/api/exchange-quotes/${encodeURIComponent(symbol)}`, signal),

  derivatives: (symbol: string, signal?: AbortSignal) =>
    apiGet<DerivativesInfo>(`/api/derivatives/${encodeURIComponent(symbol)}`, signal),

  screener: (quote = 'USDT', sort = 'volume', limit = 50, signal?: AbortSignal) =>
    apiGet<ScreenerRow[]>(
      `/api/screener?quote=${encodeURIComponent(quote)}&sort=${sort}&limit=${limit}`,
      signal,
    ),

  search: (query: string, signal?: AbortSignal) =>
    query.trim().length === 0
      ? Promise.resolve<SearchResult[]>([])
      : apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`, signal),

  news: (symbol: string | undefined, signal?: AbortSignal) =>
    apiGet<NewsItem[]>(
      `/api/news${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`,
      signal,
    ),
};
