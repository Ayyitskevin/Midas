/**
 * Portfolio risk math — pure and offline. Marks each paper position to a live
 * price for unrealized P&L and notional, and (given an assumed isolated
 * leverage) an estimated liquidation distance. Aggregates the book into gross /
 * net exposure and concentration.
 */

export interface RiskPosition {
  symbol: string;
  /** Signed: negative is short. */
  quantity: number;
  entryPrice: number;
}

export type Side = 'long' | 'short';

export interface PositionRisk {
  symbol: string;
  side: Side;
  /** Absolute size. */
  qty: number;
  entryPrice: number;
  price: number | null;
  /** Current notional: price × qty. */
  notional: number | null;
  uPnl: number | null;
  uPnlPct: number | null;
  /** Estimated isolated-margin liquidation; null without leverage. */
  liqPrice: number | null;
  /** Signed distance from price to liq (% of price); positive = safe side. */
  liqDistancePct: number | null;
}

export function positionRisk(
  pos: RiskPosition,
  price: number | null,
  leverage: number | null,
): PositionRisk {
  const dir = pos.quantity >= 0 ? 1 : -1;
  const qty = Math.abs(pos.quantity);
  const lev = leverage != null && leverage > 1 ? leverage : null;
  const p = price != null && price > 0 ? price : null;

  const notional = p != null ? p * qty : null;
  const uPnl = p != null ? (p - pos.entryPrice) * pos.quantity : null;
  const uPnlPct = p != null && pos.entryPrice > 0 ? (dir * (p - pos.entryPrice)) / pos.entryPrice * 100 : null;

  const liqPrice = lev ? pos.entryPrice * (1 - dir / lev) : null;
  const liqDistancePct = liqPrice != null && p != null ? (dir * (p - liqPrice)) / p * 100 : null;

  return {
    symbol: pos.symbol,
    side: dir === 1 ? 'long' : 'short',
    qty,
    entryPrice: pos.entryPrice,
    price: p,
    notional,
    uPnl,
    uPnlPct,
    liqPrice,
    liqDistancePct,
  };
}

export interface PortfolioRisk {
  positions: PositionRisk[];
  totalUPnl: number;
  grossNotional: number;
  /** Long − short notional. */
  netNotional: number;
  longNotional: number;
  shortNotional: number;
  /** Largest position as % of gross notional; null if no notionals. */
  maxWeightPct: number | null;
}

export function aggregateRisk(positions: PositionRisk[]): PortfolioRisk {
  let totalUPnl = 0;
  let grossNotional = 0;
  let longNotional = 0;
  let shortNotional = 0;
  let maxNotional = 0;

  for (const r of positions) {
    if (r.uPnl != null) totalUPnl += r.uPnl;
    if (r.notional != null) {
      grossNotional += r.notional;
      if (r.side === 'long') longNotional += r.notional;
      else shortNotional += r.notional;
      if (r.notional > maxNotional) maxNotional = r.notional;
    }
  }

  return {
    positions,
    totalUPnl,
    grossNotional,
    netNotional: longNotional - shortNotional,
    longNotional,
    shortNotional,
    maxWeightPct: grossNotional > 0 ? (maxNotional / grossNotional) * 100 : null,
  };
}
