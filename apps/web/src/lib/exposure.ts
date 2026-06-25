/**
 * Portfolio exposure aggregation: net / gross / long / short notional, gross &
 * net leverage versus account equity, per-asset weights, and a concentration
 * score (Herfindahl index). Positions are aggregated by symbol so a symbol held
 * across several entries nets out. Pure for unit testing.
 */

export interface ExposurePosition {
  symbol: string;
  /** Net units held; negative is short. */
  quantity: number;
  /** Current price in quote; null when unavailable. */
  price: number | null;
}

export interface AssetWeight {
  symbol: string;
  signedNotional: number; // long +, short −
  grossNotional: number; // |signed|
  weight: number; // grossNotional / total gross (0..1)
  side: 'long' | 'short';
}

export interface ExposureSummary {
  gross: number;
  net: number;
  long: number; // positive magnitude
  short: number; // positive magnitude
  grossLeverage: number | null; // gross / account
  netLeverage: number | null;
  longPct: number; // long / gross × 100
  shortPct: number;
  /** Herfindahl index Σ weightᵢ² (1/N … 1); higher = more concentrated. */
  hhi: number;
  topWeight: number; // largest single-asset weight (0..1)
  weights: AssetWeight[]; // sorted by gross notional, desc
  priced: number; // positions with a usable price
  total: number;
}

export function computeExposure(positions: ExposurePosition[], account: number): ExposureSummary {
  const bySym = new Map<string, number>();
  let priced = 0;
  for (const p of positions) {
    if (p.price == null || !(p.price > 0) || !Number.isFinite(p.quantity)) continue;
    priced += 1;
    bySym.set(p.symbol, (bySym.get(p.symbol) ?? 0) + p.quantity * p.price);
  }

  let gross = 0;
  let net = 0;
  let long = 0;
  let short = 0;
  const entries: { symbol: string; signed: number }[] = [];
  for (const [symbol, signed] of bySym) {
    if (signed === 0) continue;
    gross += Math.abs(signed);
    net += signed;
    if (signed > 0) long += signed;
    else short += -signed;
    entries.push({ symbol, signed });
  }
  entries.sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed));

  let hhi = 0;
  let topWeight = 0;
  const weights: AssetWeight[] = entries.map((e) => {
    const grossNotional = Math.abs(e.signed);
    const weight = gross > 0 ? grossNotional / gross : 0;
    hhi += weight * weight;
    if (weight > topWeight) topWeight = weight;
    return {
      symbol: e.symbol,
      signedNotional: e.signed,
      grossNotional,
      weight,
      side: e.signed >= 0 ? 'long' : 'short',
    };
  });

  const hasAcct = Number.isFinite(account) && account > 0;
  return {
    gross,
    net,
    long,
    short,
    grossLeverage: hasAcct ? gross / account : null,
    netLeverage: hasAcct ? net / account : null,
    longPct: gross > 0 ? (long / gross) * 100 : 0,
    shortPct: gross > 0 ? (short / gross) * 100 : 0,
    hhi,
    topWeight,
    weights,
    priced,
    total: positions.length,
  };
}
