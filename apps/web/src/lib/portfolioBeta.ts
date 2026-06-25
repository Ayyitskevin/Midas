/**
 * Beta-weighted portfolio exposure to BTC. A book's dollar net exposure tells
 * you how much capital is directional, but not how much it actually *moves* —
 * a high-beta alt carries more BTC risk per dollar than a stablecoin-like pair.
 * Weighting each position's signed notional by its beta vs BTC collapses the
 * whole book into a single BTC-equivalent dollar delta: the amount of spot BTC
 * that would carry the same first-order directional risk.
 *
 * btcEquivalent = Σ (signedNotionalᵢ · betaᵢ). A 1% BTC move is then expected to
 * move the book by ≈ btcEquivalent · 1%. Note the beta-weighted delta can flip
 * sign versus the raw net notional — a dollar-net-long book stacked in inverse
 * or low-beta names can still be net-short BTC risk.
 *
 * Pure and side-effect free; the module resolves notionals (qty × mark) and
 * betas (return regression vs BTC) and hands them in.
 */

export interface PBetaInput {
  symbol: string;
  /** qty × mark price, signed (long +, short −). */
  signedNotional: number;
  /** Beta vs BTC, or null when it can't be estimated. */
  beta: number | null;
}

export interface PBetaRow {
  symbol: string;
  signedNotional: number;
  beta: number;
  /** signedNotional × beta — the position's BTC-equivalent dollar delta. */
  betaWeighted: number;
  /** |betaWeighted| share of the beta-weighted gross, in [0, 1]. */
  weight: number;
}

export interface PortfolioBeta {
  /** Priced positions with a beta, sorted by |betaWeighted| desc. */
  rows: PBetaRow[];
  /** Σ signed notional (long − short), in quote $. */
  netExposure: number;
  /** Σ |signed notional|, in quote $. */
  grossExposure: number;
  /** Σ signedNotional × beta — the book's BTC-equivalent dollar delta. */
  btcEquivalent: number;
  /** Σ |signedNotional × beta| — denominator for row weights. */
  betaWeightedGross: number;
  /** btcEquivalent / netExposure (effective beta per net $); NaN when net is 0. */
  betaToNet: number;
  /** Count of positions that contributed a beta. */
  pricedCount: number;
  /** Count of positions dropped for a missing beta. */
  betaMissing: number;
}

/**
 * Aggregate beta-weighted BTC exposure across positions. Positions with a
 * zero/non-finite notional are ignored; positions with a null beta count toward
 * net/gross but are excluded from the BTC-equivalent delta (and reported via
 * betaMissing).
 */
export function portfolioBeta(inputs: PBetaInput[]): PortfolioBeta {
  let netExposure = 0;
  let grossExposure = 0;
  let btcEquivalent = 0;
  let betaWeightedGross = 0;
  let pricedCount = 0;
  let betaMissing = 0;
  const rows: PBetaRow[] = [];

  for (const p of inputs) {
    if (!Number.isFinite(p.signedNotional) || p.signedNotional === 0) continue;
    netExposure += p.signedNotional;
    grossExposure += Math.abs(p.signedNotional);
    if (p.beta == null || !Number.isFinite(p.beta)) {
      betaMissing += 1;
      continue;
    }
    const betaWeighted = p.signedNotional * p.beta;
    btcEquivalent += betaWeighted;
    betaWeightedGross += Math.abs(betaWeighted);
    pricedCount += 1;
    rows.push({ symbol: p.symbol, signedNotional: p.signedNotional, beta: p.beta, betaWeighted, weight: 0 });
  }

  for (const r of rows) {
    r.weight = betaWeightedGross > 0 ? Math.abs(r.betaWeighted) / betaWeightedGross : 0;
  }
  rows.sort((a, b) => Math.abs(b.betaWeighted) - Math.abs(a.betaWeighted));

  return {
    rows,
    netExposure,
    grossExposure,
    btcEquivalent,
    betaWeightedGross,
    betaToNet: netExposure !== 0 ? btcEquivalent / netExposure : NaN,
    pricedCount,
    betaMissing,
  };
}
