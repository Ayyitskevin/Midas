/**
 * Portfolio rebalance math — given each holding's current dollar value and a
 * target weight, work out the trades that move the book to those targets. The
 * target value of a holding is its weight times the whole portfolio; the trade
 * is the gap between that and what's held now (positive = buy, negative = sell).
 * Drift is how far the current weight has wandered from target, and turnover is
 * the one-way fraction of the book that has to change hands. Pure for testing.
 */

export interface RebalHolding {
  symbol: string;
  /** Current dollar value of the position (qty × mark). */
  value: number;
  /** Target weight as a percent of the portfolio. */
  targetPct: number;
}

export interface RebalRow {
  symbol: string;
  value: number;
  /** Current weight, percent of the portfolio. */
  currentPct: number;
  targetPct: number;
  /** Target dollar value: targetPct/100 × total. */
  targetValue: number;
  /** Dollars to trade to reach target (+buy, −sell). */
  tradeValue: number;
  /** currentPct − targetPct. */
  driftPct: number;
}

export interface RebalPlan {
  rows: RebalRow[];
  /** Σ of holding values. */
  total: number;
  /** Σ of target weights (should be ~100). */
  targetSum: number;
  /** Σ of buys. */
  totalBuy: number;
  /** Σ of sells (positive magnitude). */
  totalSell: number;
  /** One-way turnover as a percent of the portfolio. */
  turnover: number;
}

/**
 * Compute the rebalance plan for a set of holdings. Holdings with a non-finite
 * value are ignored. The portfolio total is the sum of holding values; with a
 * non-positive total every current weight is 0 and the trade is simply the
 * unwind of each position.
 */
export function rebalance(holdings: RebalHolding[]): RebalPlan {
  const valid = holdings.filter((h) => Number.isFinite(h.value));
  let total = 0;
  for (const h of valid) total += h.value;

  const rows: RebalRow[] = [];
  let targetSum = 0;
  let totalBuy = 0;
  let totalSell = 0;
  for (const h of valid) {
    const targetPct = Number.isFinite(h.targetPct) ? h.targetPct : 0;
    targetSum += targetPct;
    const currentPct = total > 0 ? (h.value / total) * 100 : 0;
    const targetValue = total > 0 ? (targetPct / 100) * total : 0;
    const tradeValue = targetValue - h.value;
    if (tradeValue > 0) totalBuy += tradeValue;
    else totalSell += -tradeValue;
    rows.push({
      symbol: h.symbol,
      value: h.value,
      currentPct,
      targetPct,
      targetValue,
      tradeValue,
      driftPct: currentPct - targetPct,
    });
  }

  return {
    rows,
    total,
    targetSum,
    totalBuy,
    totalSell,
    turnover: total > 0 ? ((totalBuy + totalSell) / 2 / total) * 100 : 0,
  };
}
