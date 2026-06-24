/**
 * Position-sizing math for the RISK module — pure, synchronous and fully
 * offline. Given an account size, the fraction of it you're willing to risk and
 * an entry/stop pair, it solves for the position size that puts exactly that
 * much capital at risk, then derives notional, margin, a rough liquidation
 * price and a ladder of R-multiple targets.
 *
 * Trade direction is inferred from the entry/stop relationship: a stop *below*
 * entry is a long, a stop *above* is a short.
 */

export type TradeSide = 'long' | 'short';

export interface RiskInputs {
  /** Total account equity, in quote currency. */
  accountSize: number;
  /** Percent of the account to risk on this trade (1 = 1%). */
  riskPct: number;
  entryPrice: number;
  stopPrice: number;
  /** Optional exchange leverage; values ≤ 1 are treated as spot (ignored). */
  leverage?: number | null;
}

export interface RiskTarget {
  /** R-multiple (reward as a multiple of the amount risked). */
  r: number;
  /** Target price in the trade's direction. */
  price: number;
  /** Profit at this target — always r × the amount risked. */
  profit: number;
}

export interface RiskResult {
  valid: boolean;
  /** Why the inputs were rejected, when `valid` is false. */
  reason: string | null;
  side: TradeSide | null;
  /** Capital risked if the stop is hit: accountSize × riskPct%. */
  riskAmount: number;
  /** Price distance from entry to stop (per unit of the base asset). */
  perUnitRisk: number;
  /** Stop distance as a percent of entry. */
  stopDistancePct: number;
  /** Position size, in units of the base asset. */
  positionSize: number;
  /** Position value at entry (positionSize × entry). */
  notional: number;
  /** Notional as a multiple of the account (how leveraged the account is). */
  accountLeverage: number;
  /** Margin posted at the given leverage, or null for spot. */
  marginRequired: number | null;
  /** Rough isolated-margin liquidation price, or null for spot. */
  liqPrice: number | null;
  /** Distance from entry to the liquidation price, as a percent of entry. */
  liqDistancePct: number | null;
  /** 1R / 2R / 3R reward targets. */
  targets: RiskTarget[];
}

/** R-multiples surfaced as take-profit targets. */
const R_TARGETS = [1, 2, 3];

function invalid(reason: string): RiskResult {
  return {
    valid: false,
    reason,
    side: null,
    riskAmount: 0,
    perUnitRisk: 0,
    stopDistancePct: 0,
    positionSize: 0,
    notional: 0,
    accountLeverage: 0,
    marginRequired: null,
    liqPrice: null,
    liqDistancePct: null,
    targets: [],
  };
}

export function computePosition(input: RiskInputs): RiskResult {
  const { accountSize, riskPct, entryPrice, stopPrice } = input;
  // Leverage is only meaningful above 1×; anything else is treated as spot.
  const leverage = input.leverage != null && input.leverage > 1 ? input.leverage : null;

  if (!(accountSize > 0)) return invalid('Account size must be a positive number.');
  if (!(riskPct > 0)) return invalid('Risk % must be a positive number.');
  if (!(entryPrice > 0)) return invalid('Entry price must be a positive number.');
  if (!(stopPrice > 0)) return invalid('Stop price must be a positive number.');
  if (entryPrice === stopPrice) return invalid('Entry and stop prices must differ.');

  const side: TradeSide = entryPrice > stopPrice ? 'long' : 'short';
  const dir = side === 'long' ? 1 : -1;

  const perUnitRisk = Math.abs(entryPrice - stopPrice);
  const riskAmount = (accountSize * riskPct) / 100;
  const positionSize = riskAmount / perUnitRisk;
  const notional = positionSize * entryPrice;
  const stopDistancePct = (perUnitRisk / entryPrice) * 100;
  const accountLeverage = notional / accountSize;

  const marginRequired = leverage ? notional / leverage : null;
  const liqDistancePct = leverage ? 100 / leverage : null;
  // Isolated-margin estimate: liquidation when the loss equals the margin,
  // ignoring maintenance margin and fees. Long liquidates below entry, short above.
  const liqPrice = leverage ? entryPrice * (1 - dir / leverage) : null;

  // Profit at an R-multiple is exactly r × riskAmount, since each R is one
  // stop-distance of favourable move on the whole position.
  const targets: RiskTarget[] = R_TARGETS.map((r) => ({
    r,
    price: entryPrice + dir * r * perUnitRisk,
    profit: r * riskAmount,
  }));

  return {
    valid: true,
    reason: null,
    side,
    riskAmount,
    perUnitRisk,
    stopDistancePct,
    positionSize,
    notional,
    accountLeverage,
    marginRequired,
    liqPrice,
    liqDistancePct,
    targets,
  };
}
