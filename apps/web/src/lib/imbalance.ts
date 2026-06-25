/**
 * Order-book depth imbalance: how lopsided the resting liquidity is between the
 * top-N bids and asks. Imbalance = (bidDepth − askDepth) / (bidDepth + askDepth)
 * in [−1, +1] — positive means more bids (buy pressure), negative more asks.
 * Pure for unit testing.
 */

import type { OrderBook, OrderBookLevel } from '@midas/shared';

export interface ImbalanceSnapshot {
  t: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number; // (bid − ask) / (bid + ask), 0 when the book is empty
  mid: number;
}

/** Cumulative size of the first `n` levels. */
export function sumDepth(levels: OrderBookLevel[], n: number): number {
  let s = 0;
  const k = Math.min(n, levels.length);
  for (let i = 0; i < k; i++) s += levels[i].amount;
  return s;
}

/** Depth imbalance of an order book over the top `levels`; null if one-sided. */
export function bookImbalance(book: OrderBook, levels: number): ImbalanceSnapshot | null {
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  if (!(bestBid > 0) || !(bestAsk > 0)) return null;
  const bidDepth = sumDepth(book.bids, levels);
  const askDepth = sumDepth(book.asks, levels);
  const tot = bidDepth + askDepth;
  return {
    t: book.timestamp || 0,
    bidDepth,
    askDepth,
    imbalance: tot > 0 ? (bidDepth - askDepth) / tot : 0,
    mid: (bestBid + bestAsk) / 2,
  };
}

/** Average imbalance across a set of snapshots (0 when empty). */
export function meanImbalance(snaps: ImbalanceSnapshot[]): number {
  if (snaps.length === 0) return 0;
  let s = 0;
  for (const x of snaps) s += x.imbalance;
  return s / snaps.length;
}
