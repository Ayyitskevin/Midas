/**
 * Cross-exchange arbitrage math — pure and offline. Across a set of venue
 * quotes, the best place to *sell* is the highest bid and the best place to
 * *buy* is the lowest ask; when the highest bid exceeds the lowest ask the book
 * is "crossed" and a (gross-of-fees) arbitrage exists. Also reports raw price
 * dispersion across venues.
 */

export interface VenueLevel {
  exchange: string;
  bid: number | null;
  ask: number | null;
  price: number;
}

export interface VenuePick {
  exchange: string;
  value: number;
}

export interface ArbResult {
  venues: number;
  /** Highest bid — sell here. */
  bestBid: VenuePick | null;
  /** Lowest ask — buy here. */
  bestAsk: VenuePick | null;
  /** bestBid − bestAsk (positive when crossed). */
  spread: number | null;
  /** spread / bestAsk × 100. */
  spreadPct: number | null;
  crossed: boolean;
  priceMin: number | null;
  priceMax: number | null;
  /** (max − min) / min × 100 across venue prices. */
  dispersionPct: number | null;
}

export function computeArb(venues: readonly VenueLevel[]): ArbResult {
  let bestBid: VenuePick | null = null;
  let bestAsk: VenuePick | null = null;
  let priceMin: number | null = null;
  let priceMax: number | null = null;

  for (const v of venues) {
    if (v.bid != null && v.bid > 0 && (bestBid === null || v.bid > bestBid.value)) {
      bestBid = { exchange: v.exchange, value: v.bid };
    }
    if (v.ask != null && v.ask > 0 && (bestAsk === null || v.ask < bestAsk.value)) {
      bestAsk = { exchange: v.exchange, value: v.ask };
    }
    if (v.price > 0) {
      if (priceMin === null || v.price < priceMin) priceMin = v.price;
      if (priceMax === null || v.price > priceMax) priceMax = v.price;
    }
  }

  const spread = bestBid && bestAsk ? bestBid.value - bestAsk.value : null;
  const spreadPct = spread != null && bestAsk ? (spread / bestAsk.value) * 100 : null;
  const dispersionPct =
    priceMin != null && priceMax != null && priceMin > 0 ? ((priceMax - priceMin) / priceMin) * 100 : null;

  return {
    venues: venues.length,
    bestBid,
    bestAsk,
    spread,
    spreadPct,
    crossed: spread != null && spread > 0,
    priceMin,
    priceMax,
    dispersionPct,
  };
}
