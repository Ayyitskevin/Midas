/**
 * Dollar-cost-averaging / position-averaging math — pure, synchronous and
 * offline. Blends a set of fills (price × size legs) into a single average
 * entry, then derives mark-to-market P&L and a rough liquidation estimate, the
 * same isolated-margin model the RISK sizer uses. Also solves the signature DCA
 * question: how much to add at a given price to pull the average to a target.
 */

export type DcaSide = 'long' | 'short';

export interface DcaLeg {
  price: number;
  qty: number;
}

export interface DcaInput {
  legs: DcaLeg[];
  side: DcaSide;
  /** Optional current price, for unrealized P&L. */
  markPrice?: number | null;
  /** Optional exchange leverage; values ≤ 1 are treated as spot. */
  leverage?: number | null;
}

export interface DcaResult {
  valid: boolean;
  reason: string | null;
  side: DcaSide;
  /** Number of valid (positive price & size) legs. */
  legCount: number;
  totalQty: number;
  /** Capital deployed: Σ price × qty. */
  totalCost: number;
  /** Blended average entry — also the break-even (fees aside). */
  avgPrice: number;
  /** Unrealized P&L at the mark, side-aware; null without a mark. */
  markPnl: number | null;
  markPnlPct: number | null;
  /** Rough isolated-margin liquidation price from the blended entry. */
  liqPrice: number | null;
  liqDistancePct: number | null;
}

export function computeDca(input: DcaInput): DcaResult {
  const { side } = input;
  const dir = side === 'long' ? 1 : -1;
  const legs = input.legs.filter((l) => l.price > 0 && l.qty > 0);
  const leverage = input.leverage != null && input.leverage > 1 ? input.leverage : null;

  const base: DcaResult = {
    valid: false,
    reason: null,
    side,
    legCount: legs.length,
    totalQty: 0,
    totalCost: 0,
    avgPrice: 0,
    markPnl: null,
    markPnlPct: null,
    liqPrice: null,
    liqDistancePct: null,
  };

  if (legs.length === 0) {
    return { ...base, reason: 'Add at least one entry with a positive price and size.' };
  }

  let totalQty = 0;
  let totalCost = 0;
  for (const l of legs) {
    totalQty += l.qty;
    totalCost += l.price * l.qty;
  }
  const avgPrice = totalCost / totalQty;

  const mark = input.markPrice != null && input.markPrice > 0 ? input.markPrice : null;
  const markPnl = mark != null ? dir * (mark - avgPrice) * totalQty : null;
  const markPnlPct = markPnl != null && totalCost > 0 ? (markPnl / totalCost) * 100 : null;

  // Isolated-margin estimate: liquidation when the loss equals the margin,
  // ignoring maintenance margin and fees. Long liquidates below the average.
  const liqPrice = leverage ? avgPrice * (1 - dir / leverage) : null;
  const liqDistancePct = leverage ? 100 / leverage : null;

  return {
    valid: true,
    reason: null,
    side,
    legCount: legs.length,
    totalQty,
    totalCost,
    avgPrice,
    markPnl,
    markPnlPct,
    liqPrice,
    liqDistancePct,
  };
}

export interface AverageSolve {
  valid: boolean;
  reason: string | null;
  /** Size to add at the next-buy price to hit the target average. */
  qty: number;
  resultingQty: number;
  resultingAvg: number;
}

/**
 * Size to add at `nextPrice` so the blended average moves from `currentAvg` to
 * `targetAvg`. Reachable only when the target sits between the current average
 * and the next-buy price (you can't pull an average past the price you buy at).
 */
export function qtyToReachAverage(
  currentQty: number,
  currentAvg: number,
  nextPrice: number,
  targetAvg: number,
): AverageSolve {
  const fail = (reason: string): AverageSolve => ({
    valid: false,
    reason,
    qty: 0,
    resultingQty: 0,
    resultingAvg: 0,
  });

  if (!(currentQty > 0)) return fail('Current size must be positive.');
  if (!(currentAvg > 0)) return fail('Current average must be positive.');
  if (!(nextPrice > 0)) return fail('Next-buy price must be positive.');
  if (!(targetAvg > 0)) return fail('Target average must be positive.');

  const denom = nextPrice - targetAvg;
  if (denom === 0) return fail('Target average can’t equal the next-buy price.');

  const qty = (currentQty * (targetAvg - currentAvg)) / denom;
  if (!(qty > 0) || !Number.isFinite(qty)) {
    return fail('Target average isn’t reachable at that price.');
  }

  const resultingQty = currentQty + qty;
  const resultingAvg = (currentQty * currentAvg + qty * nextPrice) / resultingQty;
  return { valid: true, reason: null, qty, resultingQty, resultingAvg };
}
