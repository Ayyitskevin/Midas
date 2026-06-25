/**
 * Market-quality metrics from an order book: the bid/ask spread (absolute and in
 * basis points) and the resting notional depth within the top N levels each
 * side. Used to rank a basket by how cheap/deep it is to trade. Pure for unit
 * testing.
 */

import type { OrderBook, OrderBookLevel } from '@midas/shared';

export interface LiquidityRow {
  symbol: string;
  mid: number;
  spread: number;
  spreadBps: number; // spread / mid × 10_000
  bidDepth: number; // notional (price × size) within the top N bids
  askDepth: number;
  totalDepth: number;
}

/** Resting notional (Σ price × size) of the first `n` levels. */
export function depthNotional(levels: OrderBookLevel[], n: number): number {
  let s = 0;
  const k = Math.min(n, levels.length);
  for (let i = 0; i < k; i++) s += levels[i].price * levels[i].amount;
  return s;
}

/** Spread + top-N depth for one book; null if it isn't two-sided. */
export function liquidity(symbol: string, book: OrderBook, levels: number): LiquidityRow | null {
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  if (!(bestBid > 0) || !(bestAsk > 0)) return null;
  const mid = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;
  const bidDepth = depthNotional(book.bids, levels);
  const askDepth = depthNotional(book.asks, levels);
  return {
    symbol,
    mid,
    spread,
    spreadBps: mid > 0 ? (spread / mid) * 10_000 : 0,
    bidDepth,
    askDepth,
    totalDepth: bidDepth + askDepth,
  };
}

export type LiquiditySort = 'spread' | 'depth' | 'symbol';

export function sortLiquidity(rows: LiquidityRow[], sort: LiquiditySort): LiquidityRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'depth':
        return b.totalDepth - a.totalDepth; // deepest first
      case 'spread':
      default:
        return a.spreadBps - b.spreadBps; // tightest first
    }
  });
  return out;
}
