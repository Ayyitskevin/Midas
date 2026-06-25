/**
 * Order-book slippage / market-impact math — pure and offline. Walks the resting
 * levels to estimate the average fill price (and slippage versus the touch) for
 * a market order of a given size, sized either in base units or quote notional.
 */

export interface Level {
  price: number;
  /** Resting size in base units. */
  size: number;
}

export type Side = 'buy' | 'sell';
export type SizeMode = 'base' | 'quote';

export interface FillResult {
  side: Side;
  /** The requested target (base units or quote, per mode). */
  requested: number;
  filledBase: number;
  filledQuote: number;
  avgPrice: number | null;
  /** Touch price (best ask for a buy, best bid for a sell). */
  bestPrice: number | null;
  /** Average fill vs the touch, % (positive = worse than touch). */
  slippagePct: number | null;
  /** True if the book ran out before the target was filled. */
  exhausted: boolean;
  levelsUsed: number;
}

const EPS = 1e-9;

/**
 * Consume `levels` to fill `target`. A buy walks asks low→high, a sell walks
 * bids high→low (the input is sorted defensively, so order doesn't matter).
 */
export function walkBook(levels: readonly Level[], side: Side, target: number, mode: SizeMode): FillResult {
  const sorted = levels
    .filter((l) => l.price > 0 && l.size > 0)
    .sort((a, b) => (side === 'buy' ? a.price - b.price : b.price - a.price));

  const bestPrice = sorted.length > 0 ? sorted[0].price : null;
  let filledBase = 0;
  let filledQuote = 0;
  let levelsUsed = 0;

  if (target > 0) {
    for (const lvl of sorted) {
      const remaining = mode === 'base' ? target - filledBase : target - filledQuote;
      if (remaining <= EPS) break;
      const takeBase = mode === 'base' ? Math.min(lvl.size, remaining) : Math.min(lvl.size, remaining / lvl.price);
      if (takeBase <= 0) break;
      filledBase += takeBase;
      filledQuote += takeBase * lvl.price;
      levelsUsed += 1;
    }
  }

  const avgPrice = filledBase > 0 ? filledQuote / filledBase : null;
  const slippagePct =
    avgPrice != null && bestPrice != null && bestPrice > 0
      ? (side === 'buy' ? (avgPrice - bestPrice) / bestPrice : (bestPrice - avgPrice) / bestPrice) * 100
      : null;

  const filledTarget = mode === 'base' ? filledBase : filledQuote;
  const exhausted = target > 0 && filledTarget + EPS < target;

  return { side, requested: target, filledBase, filledQuote, avgPrice, bestPrice, slippagePct, exhausted, levelsUsed };
}

export interface DepthPoint {
  price: number;
  cum: number;
}

/** Cumulative resting size by level, in the order given (best-first). */
export function cumulativeDepth(levels: readonly Level[]): DepthPoint[] {
  const out: DepthPoint[] = [];
  let cum = 0;
  for (const l of levels) {
    if (l.price <= 0 || l.size <= 0) continue;
    cum += l.size;
    out.push({ price: l.price, cum });
  }
  return out;
}
