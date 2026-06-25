/**
 * Risk of ruin — the probability that a trading bankroll is wiped out (or hits a
 * chosen drawdown barrier) before it compounds away from zero, given a per-trade
 * edge. Each trade is modeled as a bet that wins `b` times the amount risked with
 * probability `p` and loses the amount risked otherwise, so in units of "risk per
 * trade" the per-trade P&L is a random variable
 *
 *     X = +b  with probability p,   X = −1  with probability q = 1 − p.
 *
 * Treating the equity path as a drifting random walk (Brownian approximation), a
 * walk starting `U` risk-units above an absorbing barrier with positive drift μ
 * and per-step variance σ² hits the barrier with probability exp(−2μU/σ²); with
 * non-positive drift, ruin is certain. The same geometry gives the expected
 * maximum drawdown as σ²/(2μ) risk-units (capped at the ruin barrier).
 *
 * U is the number of consecutive risk-units between the starting bankroll and the
 * barrier: ruinPct / riskPct (risk 2% per trade, ruin at a 100% loss → 50 units).
 */

export interface RuinInputs {
  /** Probability of a winning trade, as a fraction in [0, 1]. */
  winRate: number;
  /** Payoff ratio b — reward-to-risk (a win returns b× the amount risked). */
  payoff: number;
  /** Capital risked per trade, as a percent of the bankroll (> 0). */
  riskPct: number;
  /** Drawdown that counts as ruin, as a percent of the bankroll. Defaults to 100. */
  ruinPct?: number;
}

export interface RuinResult {
  /** Whether the inputs were well-formed enough to model. */
  valid: boolean;
  /** Expected value per trade in R units: p·b − q. */
  expectancy: number;
  /** True when expectancy > 0 (a positive-edge system). */
  edge: boolean;
  /** Per-trade standard deviation in R units. */
  stdev: number;
  /** Risk-units of loss between the start and the ruin barrier: ruinPct / riskPct. */
  unitsToRuin: number;
  /** Probability of ruin, in [0, 1]. */
  riskOfRuin: number;
  /** Expected maximum drawdown, as a percent of the bankroll (capped at ruinPct). */
  expectedMaxDD: number;
}

/**
 * Compute the risk of ruin (plus expectancy, per-trade volatility and expected
 * max drawdown) from a win rate, payoff ratio and per-trade risk. Returns a
 * `valid: false` result for nonsensical inputs rather than throwing, so a live
 * form can render an empty state. A non-positive edge yields a certain ruin.
 */
export function riskOfRuin({
  winRate,
  payoff,
  riskPct,
  ruinPct = 100,
}: RuinInputs): RuinResult {
  const p = winRate;
  const q = 1 - p;
  const b = payoff;

  const valid =
    Number.isFinite(p) &&
    p >= 0 &&
    p <= 1 &&
    Number.isFinite(b) &&
    b > 0 &&
    Number.isFinite(riskPct) &&
    riskPct > 0 &&
    Number.isFinite(ruinPct) &&
    ruinPct > 0;

  if (!valid) {
    return {
      valid: false,
      expectancy: 0,
      edge: false,
      stdev: 0,
      unitsToRuin: 0,
      riskOfRuin: 0,
      expectedMaxDD: 0,
    };
  }

  const expectancy = p * b - q;
  // Var(X) = E[X²] − μ²,  E[X²] = p·b² + q·1².
  const variance = Math.max(0, p * b * b + q - expectancy * expectancy);
  const stdev = Math.sqrt(variance);
  const unitsToRuin = ruinPct / riskPct;

  // Non-positive drift (or a degenerate zero-variance loser) ⇒ certain ruin.
  if (expectancy <= 0) {
    return {
      valid: true,
      expectancy,
      edge: false,
      stdev,
      unitsToRuin,
      riskOfRuin: 1,
      expectedMaxDD: ruinPct,
    };
  }

  // Positive drift with no variance (a sure-thing winner) ⇒ never ruined.
  if (variance === 0) {
    return {
      valid: true,
      expectancy,
      edge: true,
      stdev,
      unitsToRuin,
      riskOfRuin: 0,
      expectedMaxDD: 0,
    };
  }

  const lambda = (2 * expectancy) / variance;
  const riskOfRuin = Math.exp(-lambda * unitsToRuin);
  const expectedMaxDD = Math.min(ruinPct, (1 / lambda) * riskPct);

  return {
    valid: true,
    expectancy,
    edge: true,
    stdev,
    unitsToRuin,
    riskOfRuin,
    expectedMaxDD,
  };
}

/**
 * Sweep the risk of ruin across a set of per-trade risk percents, holding the
 * edge fixed — the survival curve that shows how ruin probability climbs as bets
 * get bigger. Returns one point per input risk percent.
 */
export function ruinCurve(
  base: Omit<RuinInputs, 'riskPct'>,
  riskPcts: number[],
): { riskPct: number; riskOfRuin: number }[] {
  return riskPcts.map((riskPct) => ({
    riskPct,
    riskOfRuin: riskOfRuin({ ...base, riskPct }).riskOfRuin,
  }));
}
