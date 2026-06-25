/**
 * Scale-in ladder — distribute a fixed cash budget across several limit orders
 * ("rungs") spread evenly over a price range, then report the blended average
 * fill. Scaling in lets a trader build a position across a band instead of one
 * price, and weighting the rungs lets them lean into the end they expect to
 * matter most (a long usually loads heavier toward the low, a short toward the
 * high).
 *
 * Rungs are priced evenly from `priceHigh` down to `priceLow`. Each rung gets a
 * weight from the chosen scheme — flat (equal cash), linear (weight grows
 * arithmetically toward the heavy end) or geometric (grows by a fixed ratio) —
 * normalized so the cash weights sum to the whole budget. A rung's quantity is
 * its cash divided by its price, so the blended entry is budget / total qty.
 */

export type LadderWeighting = 'flat' | 'linear' | 'geometric';

export interface LadderInputs {
  /** Top of the ladder price range. */
  priceHigh: number;
  /** Bottom of the ladder price range. */
  priceLow: number;
  /** Number of rungs (limit orders) in the ladder. */
  rungs: number;
  /** Total cash to deploy across the ladder. */
  budget: number;
  /** How rung weights scale from the light end to the heavy end. */
  weighting: LadderWeighting;
  /** True to weight toward the low end (long scale-in); false toward the high (short). */
  heavyLow: boolean;
  /** Geometric growth ratio per rung (> 1); ignored by flat/linear. Defaults to 1.6. */
  ratio?: number;
}

export interface LadderRung {
  /** Limit price of this rung. */
  price: number;
  /** Normalized share of the budget at this rung, in [0, 1]. */
  weight: number;
  /** Cash deployed at this rung. */
  notional: number;
  /** Base-asset quantity bought/sold at this rung. */
  qty: number;
}

export interface LadderPlan {
  valid: boolean;
  /** Rungs in descending price order (top of range first). */
  rungs: LadderRung[];
  /** Total cash deployed (equals the budget). */
  totalNotional: number;
  /** Total base-asset quantity across all rungs. */
  totalQty: number;
  /** Blended average fill price: totalNotional / totalQty. */
  avgEntry: number;
}

const EMPTY: LadderPlan = {
  valid: false,
  rungs: [],
  totalNotional: 0,
  totalQty: 0,
  avgEntry: 0,
};

/**
 * Plan a scale-in ladder. Returns an invalid (empty) plan for nonsensical
 * inputs — non-positive prices or budget, an inverted range, or fewer than one
 * rung — rather than throwing, so a live form can render an empty state.
 */
export function ladder(inputs: LadderInputs): LadderPlan {
  const { priceHigh, priceLow, budget, weighting, heavyLow } = inputs;
  const n = Math.floor(inputs.rungs);
  const ratio = Number.isFinite(inputs.ratio) && (inputs.ratio ?? 0) > 1 ? (inputs.ratio as number) : 1.6;

  const valid =
    Number.isFinite(priceHigh) &&
    Number.isFinite(priceLow) &&
    priceHigh > 0 &&
    priceLow > 0 &&
    priceHigh >= priceLow &&
    Number.isFinite(budget) &&
    budget > 0 &&
    n >= 1;
  if (!valid) return EMPTY;

  // Even price steps from high (k=0) down to low (k=n-1).
  const priceAt = (k: number): number =>
    n === 1 ? (priceHigh + priceLow) / 2 : priceHigh - ((priceHigh - priceLow) * k) / (n - 1);

  // Raw weight from a rung's rank along the light→heavy axis (0 = lightest).
  const rawWeight = (rank: number): number => {
    if (weighting === 'linear') return rank + 1;
    if (weighting === 'geometric') return Math.pow(ratio, rank);
    return 1;
  };

  let rawSum = 0;
  const raws: number[] = [];
  for (let k = 0; k < n; k++) {
    // k=0 is the highest price. Heavy-low ⇒ lower prices rank higher.
    const rank = heavyLow ? k : n - 1 - k;
    const r = rawWeight(rank);
    raws.push(r);
    rawSum += r;
  }

  const rungs: LadderRung[] = [];
  let totalQty = 0;
  let totalNotional = 0;
  for (let k = 0; k < n; k++) {
    const price = priceAt(k);
    const weight = raws[k] / rawSum;
    const notional = budget * weight;
    const qty = notional / price;
    totalQty += qty;
    totalNotional += notional;
    rungs.push({ price, weight, notional, qty });
  }

  return {
    valid: true,
    rungs,
    totalNotional,
    totalQty,
    avgEntry: totalNotional / totalQty,
  };
}
