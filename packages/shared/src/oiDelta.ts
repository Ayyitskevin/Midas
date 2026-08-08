/**
 * OI-delta positioning contract — open-interest CHANGE vs price CHANGE over a
 * window, the classic positioning read an OI snapshot (OIV/FUND) cannot give:
 * OI↑ + price↑ = long buildup, OI↑ + price↓ = short buildup,
 * OI↓ + price↓ = long unwind, OI↓ + price↑ = short covering. Shared by the
 * server providers (ccxt live via the configured venue, mock synthetic), the
 * /api/oi-delta route, the demo engine and the web OID panel.
 *
 * Honesty rules (same idiom as options.ts / DexPools / CoinUniverse):
 * - `provenance` is 'live' | 'synthetic' | 'unavailable'; `note` is null only
 *   when live (see provenance.ts — withHonestNote enforces the caveat).
 * - A delta needs real history: a venue without an OI-history read comes back
 *   'unavailable' with an honest note — a delta is NEVER synthesized from two
 *   point-in-time snapshots and presented as history.
 * - Missing evidence is null, never a fabricated 0: an unknown then-OI or a
 *   price point that cannot be aligned comes back null.
 * - The OI change is measured on contract/base-unit OI whenever the venue
 *   reports it (price-invariant positioning), falling back to notional OI —
 *   which mechanically drifts with price — and the derivation basis is always
 *   labeled on `oiBasis` so the notional caveat stays visible.
 *
 * Pure types + pure compute helpers only — safe in Node and the browser.
 */

import type { DataProvenance } from './provenance';
import type { DataReceipt } from './dataTrust';

/** The windows the /api/oi-delta edge accepts — anything else is a 400. */
export type OiDeltaWindow = '1h' | '4h' | '24h' | '7d';

/** Accepted windows, in increasing length. */
export const OI_DELTA_WINDOWS: readonly OiDeltaWindow[] = ['1h', '4h', '24h', '7d'];

/** Window length in milliseconds. */
export const OI_DELTA_WINDOW_MS: Record<OiDeltaWindow, number> = {
  '1h': 3_600_000,
  '4h': 14_400_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
};

/** Type guard for the window whitelist — the route 400s anything outside it. */
export function isOiDeltaWindow(raw: string): raw is OiDeltaWindow {
  return (OI_DELTA_WINDOWS as readonly string[]).includes(raw);
}

/**
 * One aligned OI/price observation: the open interest at a timestamp, paired
 * with the price at that time. A venue may report OI in contracts/base units
 * (`openInterestAmount`), in notional/quote units (`openInterestValue`), or
 * both. A LIVE adapter reports exactly what the venue sent and leaves the
 * other leg null — it never back-fills a missing scalar by multiplying the
 * reported one by the price, because that would dress a derived number up as
 * venue evidence. (The synthetic mock provider is not an adapter: both legs
 * come from one simulated ground truth, so it populates both.) `price` is null
 * when no price bar could be aligned to this observation (see the provider's
 * alignment tolerance) — never an interpolated or carried-forward fabrication.
 */
export interface OiDeltaPoint {
  /** Epoch millis. */
  timestamp: number;
  /** Open interest in contracts/base units; null when the venue reports notional only. */
  openInterestAmount: number | null;
  /** Open-interest notional in quote units (e.g. USDT); null when the venue reports contracts only. */
  openInterestValue: number | null;
  /** The paired price at this timestamp; null when unalignable. */
  price: number | null;
}

/**
 * What the OI change is denominated in: 'contracts' (base units — price-
 * invariant, the rigorous positioning read) is preferred whenever both window
 * endpoints report it; 'notional' (quote units) is the labeled fallback —
 * notional OI drifts with price, so a flat-position rally can masquerade as a
 * buildup on this basis.
 */
export type OiDeltaBasis = 'contracts' | 'notional';

/** The four positioning quadrants of ΔOI × Δprice. */
export type OiDeltaClassification =
  | 'long-buildup'
  | 'short-buildup'
  | 'long-unwind'
  | 'short-covering';

/**
 * An OI-delta positioning snapshot for one perp over one window: the OI and
 * price changes across the window, the classification they imply, and the
 * aligned OI/price series itself (oldest → newest) for a sparkline. Every
 * derived field is null when its evidence is missing — `oiThen` is null when
 * there is no history, and a null change never produces a classification.
 */
export interface OiDelta {
  /** The perp symbol the data is for (e.g. BTC/USDT:USDT). */
  symbol: string;
  /** The lookback window the changes are measured over. */
  window: OiDeltaWindow;
  /** What oiNow/oiThen/oiChangePct are denominated in; null when no OI evidence. */
  oiBasis: OiDeltaBasis | null;
  /** Latest OI in the window, in the `oiBasis` unit; null when there is no history. */
  oiNow: number | null;
  /** Earliest OI in the window, in the `oiBasis` unit; null when there is no history. */
  oiThen: number | null;
  /** (oiNow/oiThen − 1) × 100; null without a positive then-OI. */
  oiChangePct: number | null;
  /** Price change over the same window in percent; null without two priced points. */
  priceChangePct: number | null;
  /** The ΔOI × Δprice quadrant; null unless both changes are known and non-flat. */
  classification: OiDeltaClassification | null;
  /** The aligned OI/price series, oldest → newest; empty when history is unavailable. */
  points: OiDeltaPoint[];
  /** Epoch millis of the newest observation; null when unavailable. */
  asOf: number | null;
  provenance: DataProvenance;
  /** Source label, e.g. 'ccxt:binance' or 'mock'. */
  source: string;
  note: string | null;
  receipt?: DataReceipt;
}

/**
 * Classify the positioning quadrant from the OI and price changes:
 * - OI↑ + price↑ = long buildup (new longs entering),
 * - OI↑ + price↓ = short buildup (new shorts entering),
 * - OI↓ + price↓ = long unwind (longs closing),
 * - OI↓ + price↑ = short covering (shorts closing).
 * Null when either change is unknown — and when either is exactly flat (0): a
 * flat OI is no buildup or unwind, and a flat price gives the quadrant no
 * direction, so neither is guessed at.
 */
export function classifyOiDelta(
  oiChangePct: number | null,
  priceChangePct: number | null,
): OiDeltaClassification | null {
  if (
    oiChangePct == null ||
    priceChangePct == null ||
    !Number.isFinite(oiChangePct) ||
    !Number.isFinite(priceChangePct) ||
    oiChangePct === 0 ||
    priceChangePct === 0
  ) {
    return null;
  }
  if (oiChangePct > 0) return priceChangePct > 0 ? 'long-buildup' : 'short-buildup';
  return priceChangePct > 0 ? 'short-covering' : 'long-unwind';
}

/**
 * Percent change from `then` to `now`, (now/then − 1) × 100. Null when either
 * side is missing or non-finite, or when `then` is not positive — a 0 or
 * negative base would make the ratio meaningless, never a fabricated percent.
 */
export function pctChange(now: number | null, then: number | null): number | null {
  if (
    now == null ||
    then == null ||
    !Number.isFinite(now) ||
    !Number.isFinite(then) ||
    then <= 0
  ) {
    return null;
  }
  return (now / then - 1) * 100;
}

/**
 * Reduce an aligned OI/price series to the board's summary fields: the then/now
 * OI endpoints, both percent changes, the classification, the freshness
 * (`asOf` = the newest observation), and the derivation basis. Pure; every
 * provider and the demo engine assemble their payloads through this one path so
 * the quadrants agree everywhere. OI and price use the exact same first/last
 * timestamps. If either endpoint lacks a price, price change and classification
 * stay null rather than silently shortening the claimed window to inner priced
 * points.
 *
 * Basis: the delta is measured on contract/base-unit OI whenever both endpoints
 * report it — contracts are price-invariant, so a flat-position rally stays a
 * flat OI change and never reads as a buildup. Notional OI is the labeled
 * fallback (`oiBasis: 'notional'`): it drifts with price, and consumers must
 * surface that caveat. When the endpoints share no common basis — or report no
 * OI at all — the OI fields and the basis come back null, never a cross-unit
 * comparison and never a fabricated change.
 */
export function summarizeOiDelta(points: OiDeltaPoint[]): Pick<
  OiDelta,
  'oiBasis' | 'oiNow' | 'oiThen' | 'oiChangePct' | 'priceChangePct' | 'classification' | 'asOf'
> {
  const first = points.length > 0 ? points[0] : null;
  const last = points.length > 1 ? points[points.length - 1] : null;
  // Reported iff the venue gave a finite, non-negative scalar. Zero is real
  // evidence — a perp CAN have no open interest, and nulling it would report a
  // genuine drain to zero as "no evidence". `pctChange` separately refuses a
  // non-positive base, so a zero endpoint yields an honest null percent while
  // the endpoints themselves still read 0.
  const usable = (value: number | null | undefined): number | null =>
    value != null && Number.isFinite(value) && value >= 0 ? value : null;
  const thenAmount = usable(first?.openInterestAmount);
  const nowAmount = usable(last?.openInterestAmount);
  const thenValue = usable(first?.openInterestValue);
  const nowValue = usable(last?.openInterestValue);
  // Contracts preferred: usable on both endpoints (or on the only endpoint of a
  // single-point series). Notional is the labeled fallback on the same rule.
  const basis: OiDeltaBasis | null =
    thenAmount !== null && (last === null || nowAmount !== null)
      ? 'contracts'
      : thenValue !== null && (last === null || nowValue !== null)
        ? 'notional'
        : null;
  const oiThen = basis === 'contracts' ? thenAmount : basis === 'notional' ? thenValue : null;
  const oiNow = basis === 'contracts' ? nowAmount : basis === 'notional' ? nowValue : null;
  const oiChangePct = pctChange(oiNow, oiThen);
  const priceChangePct = pctChange(last?.price ?? null, first?.price ?? null);

  return {
    oiBasis: basis,
    oiNow,
    oiThen,
    oiChangePct,
    priceChangePct,
    classification: classifyOiDelta(oiChangePct, priceChangePct),
    asOf: (last ?? first)?.timestamp ?? null,
  };
}
