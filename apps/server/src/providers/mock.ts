import type {
  AccountFills,
  AccountPositions,
  Balances,
  CancelResult,
  CoinUniverse,
  DerivativesInfo,
  DexPools,
  DvolSnapshot,
  DvolSymbol,
  FundingHistoryPoint,
  HistoryResponse,
  LiquidationsProvenance,
  NewsItem,
  OpenOrders,
  OptionsChain,
  OrderBook,
  Quote,
  ScreenerRow,
  SearchResult,
  SolanaMarket,
  SolanaNetwork,
  SolanaStaking,
  SolanaSwapQuote,
  SolanaTokenInfo,
  SolanaTrending,
  SolanaValidators,
  SolanaWallet,
  TermStructure,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';
import {
  mockExchangeQuotes,
  mockFundingHistory,
  mockHistory,
  mockNews,
  mockOrderBook,
  mockQuote,
  mockQuotes,
  mockScreen,
  mockSearch,
} from './mock/market';
import {
  mockDerivatives,
  mockDexPools,
  mockLiquidationsProvenance,
  mockVenueDerivatives,
} from './mock/derivatives';
import {
  mockSolanaDexPools,
  mockSolanaMarket,
  mockSolanaNetwork,
  mockSolanaQuote,
  mockSolanaStaking,
  mockSolanaToken,
  mockSolanaTrending,
  mockSolanaValidators,
  mockSolanaWallet,
} from './mock/solana';
import { mockBalances, mockFills, mockOpenOrders, mockPositions } from './mock/account';
import { mockCoinUniverse } from './mock/coins';
import { mockDvol, mockOptionsChain, mockTermStructure } from './mock/options';

/**
 * Deterministic synthetic data provider. Prices wiggle minute-to-minute (so the
 * terminal feels alive) but are stable within a given minute, and historical
 * series are fully reproducible for a (symbol, interval, range) triple.
 *
 * The provider is stateless except for one thing: demo orders canceled through
 * {@link MockProvider.cancelOrder} stay canceled for the life of the instance,
 * so the cancel-only posture behaves like a real account (cancel → the order
 * leaves the open-orders list; a repeated cancel is an honest 409).
 */
export class MockProvider implements DataProvider {
  readonly name = 'mock';
  readonly live = false;
  /** Demo-order ids canceled through this instance (keeps the demo book honest). */
  private readonly canceledDemoOrders = new Set<string>();

  getQuote(symbol: string): Promise<Quote> {
    return mockQuote(symbol);
  }
  getQuotes(symbols: string[]): Promise<Quote[]> {
    return mockQuotes(symbols);
  }
  getOrderBook(symbol: string, depth = 25): Promise<OrderBook> {
    return mockOrderBook(symbol, depth);
  }
  getExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
    return mockExchangeQuotes(symbol);
  }
  getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
    return mockVenueDerivatives(symbol);
  }
  getDerivatives(symbol: string): Promise<DerivativesInfo> {
    return mockDerivatives(symbol);
  }
  liquidationsProvenance(): LiquidationsProvenance {
    return mockLiquidationsProvenance();
  }
  getDexPools(symbol: string): Promise<DexPools> {
    return mockDexPools(symbol);
  }
  getSolanaNetwork(): Promise<SolanaNetwork> {
    return mockSolanaNetwork();
  }
  getSolanaWallet(address: string): Promise<SolanaWallet> {
    return mockSolanaWallet(address);
  }
  getSolanaTrending(): Promise<SolanaTrending> {
    return mockSolanaTrending();
  }
  getSolanaDexPools(symbol: string): Promise<DexPools> {
    return mockSolanaDexPools(symbol);
  }
  getSolanaValidators(): Promise<SolanaValidators> {
    return mockSolanaValidators();
  }
  getSolanaStaking(): Promise<SolanaStaking> {
    return mockSolanaStaking();
  }
  getSolanaToken(mint: string): Promise<SolanaTokenInfo> {
    return mockSolanaToken(mint);
  }
  getSolanaQuote(input: string, output: string, amount: number): Promise<SolanaSwapQuote> {
    return mockSolanaQuote(input, output, amount);
  }
  getSolanaMarket(): Promise<SolanaMarket> {
    return mockSolanaMarket();
  }
  getBalances(): Promise<Balances> {
    return mockBalances();
  }
  async getOpenOrders(): Promise<OpenOrders> {
    const snapshot = await mockOpenOrders();
    if (this.canceledDemoOrders.size === 0) return snapshot;
    return { ...snapshot, orders: snapshot.orders.filter((o) => !this.canceledDemoOrders.has(o.id)) };
  }
  /**
   * Deterministic hermetic cancel for the demo book: removes the order from
   * this instance's synthetic open-orders fixture, with an honest 409 for an
   * id the fixture doesn't hold (or already canceled) — the same
   * "no longer open" outcome the ccxt provider maps from a real exchange.
   */
  async cancelOrder(id: string, symbol: string): Promise<CancelResult> {
    const open = (await mockOpenOrders()).orders.some((o) => o.id === id);
    if (!open || this.canceledDemoOrders.has(id)) {
      throw new ProviderError(
        `Order ${id} on ${symbol} is no longer open — already filled or canceled (or never a demo order).`,
        409,
      );
    }
    this.canceledDemoOrders.add(id);
    return { id, symbol, status: 'canceled' };
  }
  getPositions(): Promise<AccountPositions> {
    return mockPositions();
  }
  getFills(symbol?: string): Promise<AccountFills> {
    return mockFills(symbol);
  }
  getFundingHistory(symbol: string, limit: number): Promise<FundingHistoryPoint[]> {
    return mockFundingHistory(symbol, limit);
  }
  getDvol(symbol: DvolSymbol): Promise<DvolSnapshot> {
    return mockDvol(symbol);
  }
  getFuturesTermStructure(symbol: string): Promise<TermStructure> {
    return mockTermStructure(symbol);
  }
  getOptionsChain(symbol: string, expiry?: number | 'nearest'): Promise<OptionsChain> {
    return mockOptionsChain(symbol, expiry);
  }
  screen(opts: ScreenerOptions): Promise<ScreenerRow[]> {
    return mockScreen(opts);
  }
  getHistory(symbol: string, opts: HistoryOptions): Promise<HistoryResponse> {
    return mockHistory(symbol, opts);
  }
  search(query: string): Promise<SearchResult[]> {
    return mockSearch(query);
  }
  getNews(symbol?: string): Promise<NewsItem[]> {
    return mockNews(symbol);
  }
  getCoinUniverse(limit: number): Promise<CoinUniverse> {
    return mockCoinUniverse(limit);
  }
}
