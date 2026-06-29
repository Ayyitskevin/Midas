import { walkBook, type Level, type Side } from './slippage';

/**
 * Pure order-ticket preview — builds and validates an order, then projects its
 * execution against a live L2 book snapshot. Read-only and offline: it estimates
 * the average fill, fee, slippage and whether a limit order takes now or rests.
 *
 * This is the order-entry seam that sits in front of live placement (a later,
 * separately-gated step). It NEVER submits anything — Midas is non-custodial and
 * read-only; this function only does math over public order-book data.
 */
export type OrderType = 'market' | 'limit';

export interface OrderParams {
  side: Side;
  type: OrderType;
  /** Order size in base units. */
  amount: number;
  /** Limit price (required for limit orders; ignored for market). */
  limitPrice?: number | null;
  /** Taker fee on the filled notional, in basis points (default 5 = 0.05%). */
  feeBps?: number;
}

export interface OrderPreview {
  /** True when the order is valid and previewable (no input errors). */
  ok: boolean;
  errors: string[];
  side: Side;
  type: OrderType;
  amount: number;
  /** True if the order takes liquidity now (market, or a limit that crosses the touch). */
  marketable: boolean;
  /** For a limit with an unfilled remainder: the price it would rest at; else null. */
  restingPrice: number | null;
  filledBase: number;
  /** Notional of the filled portion, in quote units. */
  filledQuote: number;
  /** Base that would not fill now (rests as a limit, or is unfilled if the book is too thin). */
  unfilledBase: number;
  avgPrice: number | null;
  /** Touch price (best ask for a buy, best bid for a sell). */
  bestPrice: number | null;
  /** Price of the last level consumed (the worst fill). */
  worstPrice: number | null;
  /** Average fill vs the touch, % (positive = worse than the touch). */
  slippagePct: number | null;
  /** True if a *market* order ran the book dry before filling. */
  exhausted: boolean;
  levelsUsed: number;
  feeBps: number;
  /** Estimated fee on the filled notional, in quote units. */
  fee: number;
  /** Cash to pay (buy) or receive (sell) for the filled portion, fee-inclusive, quote units. */
  cashValue: number;
}

const EPS = 1e-9;

export function previewOrder(
  book: { bids: readonly Level[]; asks: readonly Level[] },
  params: OrderParams,
): OrderPreview {
  const { side, type } = params;
  const amount = Number.isFinite(params.amount) ? params.amount : 0;
  const limitPrice = params.limitPrice ?? null;
  const feeBps =
    Number.isFinite(params.feeBps as number) && (params.feeBps as number) >= 0 ? (params.feeBps as number) : 5;

  // The side we consume: a buy lifts asks, a sell hits bids.
  const oppSorted = (side === 'buy' ? book.asks : book.bids)
    .filter((l) => l.price > 0 && l.size > 0)
    .sort((a, b) => (side === 'buy' ? a.price - b.price : b.price - a.price));
  const bestPrice = oppSorted.length > 0 ? oppSorted[0].price : null;

  const errors: string[] = [];
  if (!(amount > 0)) errors.push('Enter an order amount greater than zero.');
  if (type === 'limit' && !(limitPrice != null && limitPrice > 0)) errors.push('Enter a limit price greater than zero.');
  if (oppSorted.length === 0) errors.push('No resting liquidity on that side of the book.');

  const blank: OrderPreview = {
    ok: false,
    errors,
    side,
    type,
    amount,
    marketable: false,
    restingPrice: null,
    filledBase: 0,
    filledQuote: 0,
    unfilledBase: amount > 0 ? amount : 0,
    avgPrice: null,
    bestPrice,
    worstPrice: null,
    slippagePct: null,
    exhausted: false,
    levelsUsed: 0,
    feeBps,
    fee: 0,
    cashValue: 0,
  };
  if (errors.length > 0) return blank;

  // A limit order is marketable only if it crosses the touch.
  const marketable =
    type === 'market' || (bestPrice != null && (side === 'buy' ? limitPrice! >= bestPrice : limitPrice! <= bestPrice));

  if (!marketable) {
    // A resting limit: nothing fills now; it sits at the limit price.
    return { ...blank, ok: true, marketable: false, restingPrice: limitPrice, unfilledBase: amount };
  }

  // Marketable: walk the book, capping fillable levels by the limit price.
  const fillable =
    type === 'limit'
      ? oppSorted.filter((l) => (side === 'buy' ? l.price <= limitPrice! : l.price >= limitPrice!))
      : oppSorted;
  const fill = walkBook(fillable, side, amount, 'base');
  const worstPrice = fill.levelsUsed > 0 ? fillable[fill.levelsUsed - 1].price : null;
  const slippagePct =
    fill.avgPrice != null && bestPrice != null && bestPrice > 0
      ? (side === 'buy' ? (fill.avgPrice - bestPrice) / bestPrice : (bestPrice - fill.avgPrice) / bestPrice) * 100
      : null;

  const fee = (fill.filledQuote * feeBps) / 10_000;
  // Buy: you pay notional + fee. Sell: you receive notional − fee.
  const cashValue = side === 'buy' ? fill.filledQuote + fee : fill.filledQuote - fee;
  const unfilledBase = Math.max(0, amount - fill.filledBase);
  // A market order that empties the book is "exhausted"; a limit only fills to its
  // price, so any leftover there "rests" rather than being exhausted.
  const exhausted = type === 'market' && unfilledBase > EPS;

  return {
    ok: true,
    errors: [],
    side,
    type,
    amount,
    marketable: true,
    restingPrice: type === 'limit' && unfilledBase > EPS ? limitPrice : null,
    filledBase: fill.filledBase,
    filledQuote: fill.filledQuote,
    unfilledBase,
    avgPrice: fill.avgPrice,
    bestPrice,
    worstPrice,
    slippagePct,
    exhausted,
    levelsUsed: fill.levelsUsed,
    feeBps,
    fee,
    cashValue,
  };
}
