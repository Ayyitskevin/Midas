/**
 * Pure position-accounting helpers — no React/store deps so they can be unit
 * tested directly and reused by both the store and the module.
 */

/** A single buy/sell to fold into a position (quantity < 0 = sell/short). */
export interface Trade {
  quantity: number;
  price: number;
}

/**
 * Average-cost accounting for folding one trade into an existing net position.
 * Returns the new {quantity, entryPrice}, or null when the position closes out
 * (nets to zero).
 *
 *  - opening from flat        → basis = trade price
 *  - adding on the same side  → quantity-weighted average basis
 *  - reducing the same side   → basis unchanged
 *  - flipping through zero     → basis = trade price for the residual
 */
export function applyTrade(
  pos: { quantity: number; entryPrice: number },
  trade: Trade,
): { quantity: number; entryPrice: number } | null {
  const oldQty = pos.quantity;
  const newQty = oldQty + trade.quantity;
  if (newQty === 0) return null;
  if (oldQty === 0) return { quantity: newQty, entryPrice: trade.price };

  const sameSide = Math.sign(oldQty) === Math.sign(newQty);
  if (!sameSide) {
    // Crossed zero: the surviving lot is the new trade's residual.
    return { quantity: newQty, entryPrice: trade.price };
  }
  const increasing = Math.sign(trade.quantity) === Math.sign(oldQty);
  if (increasing) {
    const entryPrice = (oldQty * pos.entryPrice + trade.quantity * trade.price) / newQty;
    return { quantity: newQty, entryPrice };
  }
  // Reducing the same side leaves the cost basis untouched.
  return { quantity: newQty, entryPrice: pos.entryPrice };
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
