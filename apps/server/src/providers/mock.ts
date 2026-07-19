import type {
  AccountFills,
  AccountPositions,
  Balances,
  CoinUniverse,
  DerivativesInfo,
  DexPools,
  FundingHistoryPoint,
  HistoryResponse,
  LiquidationsProvenance,
  NewsItem,
  OpenOrders,
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
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
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

/**
 * Deterministic synthetic data provider. Prices wiggle minute-to-minute (so the
 * terminal feels alive) but are stable within a given minute, and historical
 * series are fully reproducible for a (symbol, interval, range) triple.
 *
 * The provider is stateless: every method is a thin delegator to a pure
 * synthetic generator, grouped by domain under ./mock (market, derivatives,
 * solana, account) over the shared roster fixtures and quote engine.
 */
export class MockProvider implements DataProvider {
  readonly name = 'mock';
  readonly live = false;

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
  getOpenOrders(): Promise<OpenOrders> {
    return mockOpenOrders();
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
