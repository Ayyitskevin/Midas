/**
 * Options / DVOL / futures term-structure contract — the trader-lens surface
 * Deribit drives for BTC/ETH price discovery. Shared by the server providers
 * (ccxt live via Deribit, mock synthetic), the routes, the demo engine and the
 * web panels.
 *
 * Honesty rules (same idiom as DexPools / CoinUniverse):
 * - `provenance` is 'live' | 'synthetic' | 'unavailable'; `note` is null only
 *   when live (see provenance.ts — withHonestNote enforces the caveat).
 * - Missing evidence is null, never a fabricated 0: an unknown DVOL level, an
 *   option without OI, or a venue without dated futures comes back null /
 *   unavailable with an honest note.
 *
 * Pure types + pure compute helpers only — safe in Node and the browser.
 */

import type { DataProvenance } from './provenance';
import type { DataReceipt } from './dataTrust';

/** Underliers Deribit publishes a DVOL volatility index for. */
export type DvolSymbol = 'BTC' | 'ETH';

/** One point of a DVOL index history (a daily close, epoch millis). */
export interface DvolPoint {
  time: number;
  value: number;
}

/**
 * A DVOL snapshot: the current level of Deribit's 30-day forward-looking
 * volatility index, plus recent daily closes for a sparkline. `value` is in
 * vol points (annualized %); null when the venue reports none. `history` is
 * oldest → newest and empty when history is unavailable — a missing history
 * must never be synthesized from the current value.
 */
export interface DvolSnapshot {
  symbol: DvolSymbol;
  value: number | null;
  history: DvolPoint[];
  asOf: number | null;
  provenance: DataProvenance;
  /** Source label, e.g. 'ccxt:deribit' or 'mock'. */
  source: string;
  note: string | null;
  receipt?: DataReceipt;
}

/** One dated future on the term structure. */
export interface TermStructurePoint {
  /** Epoch millis of expiry. */
  expiry: number;
  /** The exchange instrument, e.g. 'BTC/USD:BTC-240927' (ccxt unified form). */
  futureSymbol: string;
  /** Last/mark price of the future in USD; never fabricated. */
  price: number;
  /** Annualized basis vs the reference price, in percent (positive = contango). */
  annualizedBasisPct: number;
  daysToExpiry: number;
}

/**
 * The futures term structure for one underlying: dated futures ranked by
 * expiry with their annualized basis vs the reference (the perpetual mark
 * when available, else the spot index), so the panel can read the calendar
 * curve and compare the perp against it.
 */
export interface TermStructure {
  /** Base asset, e.g. 'BTC'. */
  underlying: string;
  /** The price the basis is computed against (perp mark preferred); null if none. */
  referencePrice: number | null;
  /** The perpetual swap's price for comparison; null when the venue lists none. */
  perpPrice: number | null;
  /** Dated futures, nearest expiry first; empty when unavailable. */
  points: TermStructurePoint[];
  asOf: number | null;
  provenance: DataProvenance;
  source: string;
  note: string | null;
  receipt?: DataReceipt;
}

/**
 * One strike of an options chain. OI is in the venue's contract units (Deribit
 * reports outstanding contracts; the contract size cancels out of max pain and
 * the put/call ratio, so both stay honest without a conversion). Marks are in
 * USD. Any field the venue does not report is null — never 0.
 */
export interface OptionsChainEntry {
  strike: number;
  /** Epoch millis of expiry (same for every entry of a chain). */
  expiry: number;
  callOi: number | null;
  putOi: number | null;
  callMark: number | null;
  putMark: number | null;
  /** Mark implied volatility in percent (e.g. 55 = 55%); null when unreported. */
  iv: number | null;
}

/**
 * The options chain for one underlying at one expiry: strikes around the
 * money with call/put OI and marks, plus the derived max-pain strike and the
 * put/call OI ratio — both null when the OI evidence is missing, never
 * computed off fabricated zeros presented as real.
 */
export interface OptionsChain {
  /** Base asset, e.g. 'BTC'. */
  underlying: string;
  /** Epoch millis of the expiry this chain is for. */
  expiry: number;
  /** The reference (underlying index / perp) price at snapshot time; null if unknown. */
  underlyingPrice: number | null;
  /** Strikes ascending. */
  entries: OptionsChainEntry[];
  maxPainStrike: number | null;
  putCallOiRatio: number | null;
  asOf: number | null;
  provenance: DataProvenance;
  source: string;
  note: string | null;
  receipt?: DataReceipt;
}

type CompleteOpenInterest<T extends { callOi: number | null; putOi: number | null }> = T & {
  callOi: number;
  putOi: number;
};

function hasCompleteOpenInterest<T extends { callOi: number | null; putOi: number | null }>(
  entry: T,
): entry is CompleteOpenInterest<T> {
  return (
    entry.callOi !== null && Number.isFinite(entry.callOi) && entry.callOi >= 0 &&
    entry.putOi !== null && Number.isFinite(entry.putOi) && entry.putOi >= 0
  );
}

/**
 * Annualized simple basis of a dated future vs a reference price, in percent:
 * (F/S − 1) × 365/days × 100. Positive is contango (future rich), negative is
 * backwardation. Null when the math is not meaningful — a non-positive or
 * missing price, or a non-positive time to expiry — so an expired or unpriced
 * contract never reports a fabricated basis.
 */
export function annualizedBasisPct(
  futurePrice: number | null,
  referencePrice: number | null,
  daysToExpiry: number | null,
): number | null {
  if (
    futurePrice == null ||
    referencePrice == null ||
    daysToExpiry == null ||
    !Number.isFinite(futurePrice) ||
    !Number.isFinite(referencePrice) ||
    !Number.isFinite(daysToExpiry) ||
    futurePrice <= 0 ||
    referencePrice <= 0 ||
    daysToExpiry <= 0
  ) {
    return null;
  }
  return ((futurePrice / referencePrice - 1) * 365 * 100) / daysToExpiry;
}

/**
 * Max pain: the expiry price at which option buyers' aggregate intrinsic value
 * is smallest — for each candidate strike K, the total payout is
 * Σ callOi·max(K − strike, 0) + Σ putOi·max(strike − K, 0), and max pain is
 * the K minimizing it. Null when any contributing strike lacks either side's
 * OI, because absent OI is unknown rather than zero. Also null when no strike
 * carries positive OI — never a strike picked off incomplete or empty evidence.
 */
export function computeMaxPainStrike(
  entries: ReadonlyArray<Pick<OptionsChainEntry, 'strike' | 'callOi' | 'putOi'>>,
): number | null {
  const completeEntries = entries.filter(hasCompleteOpenInterest);
  if (
    entries.length === 0 ||
    completeEntries.length !== entries.length ||
    !completeEntries.some((entry) => entry.callOi > 0 || entry.putOi > 0)
  ) {
    return null;
  }
  let best: { strike: number; pain: number } | null = null;
  for (const candidate of completeEntries) {
    const k = candidate.strike;
    let pain = 0;
    for (const entry of completeEntries) {
      pain += entry.callOi * Math.max(k - entry.strike, 0) + entry.putOi * Math.max(entry.strike - k, 0);
    }
    if (best === null || pain < best.pain) best = { strike: k, pain };
  }
  return best?.strike ?? null;
}

/**
 * Put/call open-interest ratio (total put OI ÷ total call OI) — the classic
 * positioning gauge (> 1 = put-heavy). Null when any contributing strike lacks
 * either side's OI, because absent OI is unknown rather than zero. Also null
 * when total call OI is zero (the ratio is undefined, never infinite).
 */
export function computePutCallOiRatio(
  entries: ReadonlyArray<Pick<OptionsChainEntry, 'callOi' | 'putOi'>>,
): number | null {
  const completeEntries = entries.filter(hasCompleteOpenInterest);
  if (entries.length === 0 || completeEntries.length !== entries.length) {
    return null;
  }
  let call = 0;
  let put = 0;
  for (const e of completeEntries) {
    call += e.callOi;
    put += e.putOi;
  }
  if (call <= 0) return null;
  return put / call;
}
