/**
 * Kelly criterion — the bet fraction that maximizes the long-run growth rate of
 * a bankroll given an edge. For a binary bet that wins `b` times the stake with
 * probability `p` (and loses the whole stake otherwise), the growth-optimal
 * fraction of capital to risk is
 *
 *     f* = (b·p − q) / b   with q = 1 − p,
 *
 * which is equivalently p − q/b. A negative f* means there is no edge and the
 * growth-optimal bet is zero, so we clamp the actionable fraction to [0, 1].
 *
 * Because full Kelly is famously aggressive (its short-run drawdowns are brutal),
 * traders usually scale it down — half- and quarter-Kelly are reported alongside.
 */

export interface KellyInputs {
  /** Probability of a winning outcome, as a fraction in [0, 1]. */
  winRate: number;
  /** Payoff ratio b — reward-to-risk (a win returns b× the amount risked). */
  payoff: number;
}

export interface KellyResult {
  /** Whether the inputs were well-formed enough to size a bet. */
  valid: boolean;
  /** Raw Kelly fraction f* — may be negative when there is no edge. */
  raw: number;
  /** Actionable full-Kelly fraction, clamped to [0, 1]. */
  fraction: number;
  /** Half-Kelly fraction (fraction / 2). */
  half: number;
  /** Quarter-Kelly fraction (fraction / 4). */
  quarter: number;
  /** Expected value per unit risked, in R: p·b − q. Positive means an edge. */
  expectancy: number;
  /** True when expectancy > 0 (a positive-edge bet worth taking). */
  edge: boolean;
  /** Win rate at which the edge vanishes for this payoff: 1 / (1 + b). */
  breakevenWin: number;
}

/**
 * Compute the Kelly-optimal bet fraction (plus half/quarter scalings and the
 * edge diagnostics) from a win rate and a payoff ratio. Returns a `valid: false`
 * result for nonsensical inputs (probability outside [0, 1], non-positive payoff)
 * rather than throwing, so a live form can render it as an empty state.
 */
export function kelly({ winRate, payoff }: KellyInputs): KellyResult {
  const p = winRate;
  const q = 1 - p;
  const b = payoff;

  const valid =
    Number.isFinite(p) && p >= 0 && p <= 1 && Number.isFinite(b) && b > 0;
  if (!valid) {
    return {
      valid: false,
      raw: 0,
      fraction: 0,
      half: 0,
      quarter: 0,
      expectancy: 0,
      edge: false,
      breakevenWin: NaN,
    };
  }

  const raw = (b * p - q) / b;
  const fraction = Math.max(0, Math.min(1, raw));
  const expectancy = p * b - q;

  return {
    valid: true,
    raw,
    fraction,
    half: fraction / 2,
    quarter: fraction / 4,
    expectancy,
    edge: expectancy > 0,
    breakevenWin: 1 / (1 + b),
  };
}
