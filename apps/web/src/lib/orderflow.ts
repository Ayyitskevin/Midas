/**
 * Order-flow / cumulative-volume-delta (CVD) math. Aggressive buys add to
 * delta, aggressive sells subtract; the running sum is the CVD, a read on
 * whether buyers or sellers are leaning on the tape. Trades are bucketed into
 * fixed time windows for the delta histogram. Kept free of React for testing.
 */

import type { Trade } from '@midas/shared';

/** One time window of order flow with the running CVD through its end. */
export interface FlowBucket {
  t: number; // bucket start (epoch ms)
  buy: number; // aggressive buy volume (base units)
  sell: number; // aggressive sell volume (positive)
  delta: number; // buy − sell
  cvd: number; // cumulative delta through the end of this bucket
  trades: number;
}

/** Aggregate order-flow stats across a set of trades. */
export interface FlowSummary {
  buyVol: number;
  sellVol: number;
  delta: number; // buyVol − sellVol (equals the latest CVD)
  buyRatio: number; // buyVol / (buyVol + sellVol); 0.5 when empty
  trades: number;
}

/** Signed base volume: + for aggressive buys, − for aggressive sells. */
export function signedVolume(trade: Trade): number {
  return trade.side === 'buy' ? trade.amount : -trade.amount;
}

/**
 * Fold trades into fixed time buckets (oldest → newest) carrying a running CVD.
 * Input order doesn't matter — trades are sorted by timestamp first. Only
 * windows that actually contain trades are emitted.
 */
export function bucketFlow(trades: Trade[], bucketMs: number): FlowBucket[] {
  if (trades.length === 0 || bucketMs <= 0) return [];
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const map = new Map<number, FlowBucket>();
  const order: number[] = [];
  for (const t of sorted) {
    const key = Math.floor(t.timestamp / bucketMs) * bucketMs;
    let b = map.get(key);
    if (!b) {
      b = { t: key, buy: 0, sell: 0, delta: 0, cvd: 0, trades: 0 };
      map.set(key, b);
      order.push(key);
    }
    if (t.side === 'buy') b.buy += t.amount;
    else b.sell += t.amount;
    b.trades += 1;
  }
  let cvd = 0;
  const out: FlowBucket[] = [];
  for (const key of order) {
    const b = map.get(key)!;
    b.delta = b.buy - b.sell;
    cvd += b.delta;
    b.cvd = cvd;
    out.push(b);
  }
  return out;
}

/** Aggregate buy/sell volume, net delta and buy ratio across all trades. */
export function flowSummary(trades: Trade[]): FlowSummary {
  let buyVol = 0;
  let sellVol = 0;
  for (const t of trades) {
    if (t.side === 'buy') buyVol += t.amount;
    else sellVol += t.amount;
  }
  const total = buyVol + sellVol;
  return {
    buyVol,
    sellVol,
    delta: buyVol - sellVol,
    buyRatio: total > 0 ? buyVol / total : 0.5,
    trades: trades.length,
  };
}
