import type {
  AccountEquityResponse,
  AccountEventsResponse,
  AccountKeysInput,
  AccountKeysMeta,
  AccountKeysResponse,
  AccountFills,
  AccountPositions,
  Alert,
  AlertInput,
  AlertTrigger,
  ApiError,
  AuthSession,
  AuthStatus,
  Balances,
  CancelResult,
  DerivativesInfo,
  DexPools,
  OpenOrders,
  FundingHistoryPoint,
  FundingRow,
  LiquidationsFeed,
  HealthResponse,
  HistoryResponse,
  Interval,
  NewsItem,
  OrderBook,
  OrderRequest,
  PlacedOrder,
  Quote,
  Range,
  ScreenerRow,
  SearchResult,
  SolanaNetwork,
  SolanaWallet,
  SystemStatus,
  TradingStatus,
  User,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import { authToken } from './authToken';

/** Optional base URL for the API (e.g. when web and server are on different hosts). */
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** Server-stored per-user snapshot — `blob` is the opaque client payload. */
export interface SnapshotResponse {
  snapshot: { blob: unknown; updatedAt: number } | null;
}

/** Merge in the bearer token when we have one (auth-enabled deployments). */
function authHeaders(base: Record<string, string>): Record<string, string> {
  const t = authToken.get();
  return t ? { ...base, Authorization: `Bearer ${t}` } : base;
}

/** Turn a non-OK response into an Error, dropping the session on a 401. */
async function fail(res: Response): Promise<never> {
  if (res.status === 401 && authToken.get()) authToken.fireUnauthorized();
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as ApiError;
    if (body?.message) message = body.message;
  } catch {
    // non-JSON error body — keep the generic message
  }
  throw new Error(message);
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal,
    headers: authHeaders({ Accept: 'application/json' }),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    signal,
    headers: authHeaders({ 'content-type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

async function apiSend<T>(
  method: 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: authHeaders({ 'content-type': 'application/json', Accept: 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return fail(res);
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

  venueDerivatives: (symbol: string, signal?: AbortSignal) =>
    apiGet<VenueDerivatives[]>(`/api/venue-derivatives/${encodeURIComponent(symbol)}`, signal),

  derivatives: (symbol: string, signal?: AbortSignal) =>
    apiGet<DerivativesInfo>(`/api/derivatives/${encodeURIComponent(symbol)}`, signal),

  dexPools: (symbol: string, signal?: AbortSignal) =>
    apiGet<DexPools>(`/api/onchain/${encodeURIComponent(symbol)}`, signal),

  // Read-only Solana reads (non-custodial; public RPC only, no signing).
  solanaNetwork: (signal?: AbortSignal) => apiGet<SolanaNetwork>('/api/solana/network', signal),
  solanaWallet: (address: string, signal?: AbortSignal) =>
    apiGet<SolanaWallet>(`/api/solana/wallet/${encodeURIComponent(address)}`, signal),

  // Read-only account reads (non-custodial; keyed via the server env).
  balances: (signal?: AbortSignal) => apiGet<Balances>('/api/balances', signal),
  openOrders: (signal?: AbortSignal) => apiGet<OpenOrders>('/api/orders', signal),
  positions: (signal?: AbortSignal) => apiGet<AccountPositions>('/api/positions', signal),
  fills: (symbol?: string, signal?: AbortSignal) =>
    apiGet<AccountFills>(`/api/fills${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`, signal),
  // The account watcher's event feed (order placed / filled / canceled).
  // Pass the last seen id to receive only newer events.
  accountEvents: (since?: number, signal?: AbortSignal) =>
    apiGet<AccountEventsResponse>(`/api/account/events${since ? `?since=${since}` : ''}`, signal),
  // The server's persisted account equity series (read-only snapshots).
  accountEquity: (signal?: AbortSignal) =>
    apiGet<AccountEquityResponse>('/api/account/equity', signal),
  // Operational self-description (SYS panel): which loops are running.
  system: (signal?: AbortSignal) => apiGet<SystemStatus>('/api/system', signal),
  // Per-user exchange keys (KEYS panel). Write-only: the PUT body carries the
  // secrets exactly once; every response is metadata only.
  accountKeys: (signal?: AbortSignal) => apiGet<AccountKeysResponse>('/api/account/keys', signal),
  saveAccountKeys: (input: AccountKeysInput, signal?: AbortSignal) =>
    apiSend<AccountKeysMeta>('PUT', '/api/account/keys', input, signal),
  deleteAccountKeys: (signal?: AbortSignal) =>
    apiSend<{ ok: boolean }>('DELETE', '/api/account/keys', undefined, signal),
  // Read-only single-order lookup — TICKET tracks a placement with this.
  getOrder: (id: string, symbol: string, signal?: AbortSignal) =>
    apiGet<PlacedOrder>(
      `/api/orders/${encodeURIComponent(id)}?symbol=${encodeURIComponent(symbol)}`,
      signal,
    ),

  // Live trading (opt-in, off by default). status() tells the UI whether placement
  // is possible; placeOrder() is the only call that can submit a real order.
  tradingStatus: (signal?: AbortSignal) => apiGet<TradingStatus>('/api/trading/status', signal),
  placeOrder: (req: OrderRequest, signal?: AbortSignal) => apiPost<PlacedOrder>('/api/orders', req, signal),
  cancelOrder: (id: string, symbol: string, signal?: AbortSignal) =>
    apiSend<CancelResult>(
      'DELETE',
      `/api/orders/${encodeURIComponent(id)}?symbol=${encodeURIComponent(symbol)}`,
      undefined,
      signal,
    ),

  fundingHistory: (symbol: string, limit = 90, signal?: AbortSignal) =>
    apiGet<FundingHistoryPoint[]>(
      `/api/funding-history/${encodeURIComponent(symbol)}?limit=${limit}`,
      signal,
    ),

  funding: (quote = 'USDT', limit = 30, signal?: AbortSignal) =>
    apiGet<FundingRow[]>(`/api/funding?quote=${encodeURIComponent(quote)}&limit=${limit}`, signal),

  liquidations: (quote = 'USDT', limit = 30, signal?: AbortSignal) =>
    apiGet<LiquidationsFeed>(
      `/api/liquidations?quote=${encodeURIComponent(quote)}&limit=${limit}`,
      signal,
    ),

  screener: (quote = 'USDT', sort = 'volume', limit = 50, signal?: AbortSignal) =>
    apiGet<ScreenerRow[]>(
      `/api/screener?quote=${encodeURIComponent(quote)}&sort=${sort}&limit=${limit}`,
      signal,
    ),

  aiChat: (
    messages: Array<{ role: string; content: string }>,
    symbol: string | undefined,
    signal?: AbortSignal,
  ) =>
    apiPost<{ role: string; content: string }>('/api/ai/chat', { messages, symbol }, signal),

  search: (query: string, signal?: AbortSignal) =>
    query.trim().length === 0
      ? Promise.resolve<SearchResult[]>([])
      : apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`, signal),

  news: (symbol: string | undefined, signal?: AbortSignal) =>
    apiGet<NewsItem[]>(
      `/api/news${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`,
      signal,
    ),

  // Server-side alerts.
  listAlerts: (signal?: AbortSignal) => apiGet<Alert[]>('/api/alerts', signal),
  alertLog: (signal?: AbortSignal) => apiGet<AlertTrigger[]>('/api/alerts/log', signal),
  createAlert: (input: AlertInput, signal?: AbortSignal) =>
    apiPost<Alert>('/api/alerts', input, signal),
  updateAlert: (id: string, patch: { enabled?: boolean; rearm?: boolean }, signal?: AbortSignal) =>
    apiSend<Alert>('PATCH', `/api/alerts/${encodeURIComponent(id)}`, patch, signal),
  deleteAlert: (id: string, signal?: AbortSignal) =>
    apiSend<{ ok: boolean }>('DELETE', `/api/alerts/${encodeURIComponent(id)}`, undefined, signal),

  // Per-user workspace sync — the layout blob is opaque to the server.
  getWorkspaces: (signal?: AbortSignal) =>
    apiGet<SnapshotResponse>('/api/workspaces', signal),
  putWorkspaces: (blob: unknown, signal?: AbortSignal) =>
    apiSend<{ ok: boolean; updatedAt: number }>('PUT', '/api/workspaces', blob, signal),

  // Per-user portfolio sync — the book blob is opaque to the server.
  getPortfolio: (signal?: AbortSignal) =>
    apiGet<SnapshotResponse>('/api/portfolio', signal),
  putPortfolio: (blob: unknown, signal?: AbortSignal) =>
    apiSend<{ ok: boolean; updatedAt: number }>('PUT', '/api/portfolio', blob, signal),

  // Per-user watchlist sync — the lists blob is opaque to the server.
  getWatchlists: (signal?: AbortSignal) =>
    apiGet<SnapshotResponse>('/api/watchlists', signal),
  putWatchlists: (blob: unknown, signal?: AbortSignal) =>
    apiSend<{ ok: boolean; updatedAt: number }>('PUT', '/api/watchlists', blob, signal),

  // Per-user notes sync — the notes blob is opaque to the server.
  getNotes: (signal?: AbortSignal) => apiGet<SnapshotResponse>('/api/notes', signal),
  putNotes: (blob: unknown, signal?: AbortSignal) =>
    apiSend<{ ok: boolean; updatedAt: number }>('PUT', '/api/notes', blob, signal),

  // Auth.
  authStatus: (signal?: AbortSignal) => apiGet<AuthStatus>('/api/auth/status', signal),
  me: (signal?: AbortSignal) => apiGet<User>('/api/auth/me', signal),
  login: (username: string, password: string, signal?: AbortSignal) =>
    apiPost<AuthSession>('/api/auth/login', { username, password }, signal),
  signup: (username: string, password: string, signal?: AbortSignal) =>
    apiPost<AuthSession>('/api/auth/signup', { username, password }, signal),

  // Account management.
  changePassword: (currentPassword: string, newPassword: string, signal?: AbortSignal) =>
    apiPost<AuthSession>('/api/auth/password', { currentPassword, newPassword }, signal),
  logoutAll: (signal?: AbortSignal) => apiPost<AuthSession>('/api/auth/logout-all', {}, signal),
  listUsers: (signal?: AbortSignal) => apiGet<User[]>('/api/auth/users', signal),
  deleteUser: (id: string, signal?: AbortSignal) =>
    apiSend<{ ok: boolean }>('DELETE', `/api/auth/users/${encodeURIComponent(id)}`, undefined, signal),
};
