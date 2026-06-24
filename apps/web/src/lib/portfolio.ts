/**
 * Pure position-accounting helpers — no React/store deps so they can be unit
 * tested directly and reused by both the store and the module.
 */

/** A single buy/sell to fold into a position (quantity < 0 = sell/short). */
export interface Trade {
  quantity: number;
  price: number;
}

export interface Lot {
  quantity: number;
  entryPrice: number;
}

export interface TradeResult {
  /** The resulting net position, or null when it closes out (nets to zero). */
  position: Lot | null;
  /** Realized P&L booked by this trade — 0 for opens / adds, signed on closes. */
  realized: number;
}

/**
 * Average-cost accounting for folding one trade into an existing net position,
 * returning both the new position and any realized P&L:
 *
 *  - opening from flat        → basis = trade price, realized 0
 *  - adding on the same side  → quantity-weighted average basis, realized 0
 *  - reducing the same side   → basis unchanged, book P&L on the closed units
 *  - closing to flat          → null, book P&L on the whole position
 *  - flipping through zero     → basis = trade price for the residual, book P&L
 *                                 on the units that were closed
 */
export function foldTrade(pos: Lot, trade: Trade): TradeResult {
  const oldQty = pos.quantity;
  const e = pos.entryPrice;
  const p = trade.price;
  const newQty = oldQty + trade.quantity;

  if (oldQty === 0) {
    return { position: newQty === 0 ? null : { quantity: newQty, entryPrice: p }, realized: 0 };
  }

  const reducing = Math.sign(trade.quantity) !== Math.sign(oldQty);
  if (!reducing) {
    // Same side → quantity-weighted average basis; nothing realized.
    const entryPrice = (oldQty * e + trade.quantity * p) / newQty;
    return { position: { quantity: newQty, entryPrice }, realized: 0 };
  }

  // Reducing / closing / flipping: book P&L on the closed units. A long gains
  // when sold above basis; a short gains when bought below it — the
  // sign(oldQty) factor handles both.
  const closedUnits = Math.min(Math.abs(trade.quantity), Math.abs(oldQty));
  const realized = closedUnits * (p - e) * Math.sign(oldQty);

  if (newQty === 0) return { position: null, realized };
  if (Math.sign(newQty) !== Math.sign(oldQty)) {
    return { position: { quantity: newQty, entryPrice: p }, realized }; // flipped through zero
  }
  return { position: { quantity: newQty, entryPrice: e }, realized }; // partial reduce
}

/** Position-only view of {@link foldTrade}, kept for callers that ignore P&L. */
export function applyTrade(pos: Lot, trade: Trade): Lot | null {
  return foldTrade(pos, trade).position;
}

export interface PositionMetrics {
  /** Signed cost basis (quantity × entry). */
  cost: number;
  /** Mark-to-market value, or null when no mark is available. */
  value: number | null;
  /** Unrealized P&L (works for shorts: negative quantity flips the sign). */
  pnl: number | null;
  /** Return on the gross cost basis, in percent. Positive = gain for the side. */
  pnlPct: number | null;
}

/** Mark-to-market a single position. Handles longs and shorts symmetrically. */
export function positionMetrics(
  quantity: number,
  entryPrice: number,
  mark: number | null,
): PositionMetrics {
  const cost = quantity * entryPrice;
  const value = mark != null ? quantity * mark : null;
  const pnl = mark != null ? (mark - entryPrice) * quantity : null;
  const pnlPct = pnl != null && cost !== 0 ? (pnl / Math.abs(cost)) * 100 : null;
  return { cost, value, pnl, pnlPct };
}
