/**
 * Funding-carry / cash-and-carry math — pure and offline. Pairs each perp's
 * annualized funding (the carry you harvest delta-neutral) with its basis versus
 * spot (perp mark vs spot price), and names the leg that earns the funding.
 * Complements the raw funding board by framing funding as a trade.
 */

import {
  conservativeDataProvenance,
  deriveDataReceipt,
  type DataReceipt,
  type FundingRow,
  type Quote,
} from '@midas/shared';
import { annualizedFundingPct } from './funding';
import { isReceiptActionable, isReceiptFresh } from './receiptView';

export interface CarrySource {
  symbol: string;
  fundingRate: number | null;
  /**
   * Hours between funding settlements; null/omitted when the venue does not
   * report it — the APR then renders null rather than assuming 8h.
   */
  fundingIntervalHours?: number | null;
  markPrice: number | null;
  openInterestValue: number | null;
  nextFundingTime: number | null;
}

/** Which leg collects funding: short the perp when funding is positive. */
export type CarrySide = 'short-perp' | 'long-perp' | 'flat';

export interface CarryRow {
  symbol: string;
  fundingRate: number | null;
  /** Annualized funding (%). */
  aprPct: number | null;
  /** Perp mark vs spot, (mark/spot − 1) × 100. */
  basisPct: number | null;
  oi: number | null;
  nextFundingTime: number | null;
  side: CarrySide;
  mark: number | null;
  spot: number | null;
}

export interface InspectedCarryRow extends CarryRow {
  receipt: DataReceipt | null;
  /** True only for fresh live evidence; synthetic demo values stay illustrative. */
  actionable: boolean;
}

const EPS = 1e-9;

export function computeCarry(src: CarrySource, spot: number | null): CarryRow {
  const mark = src.markPrice != null && src.markPrice > 0 ? src.markPrice : null;
  const sp = spot != null && spot > 0 ? spot : null;
  const basisPct = mark != null && sp != null ? (mark / sp - 1) * 100 : null;

  const fr = src.fundingRate;
  const side: CarrySide = fr == null || Math.abs(fr) < EPS ? 'flat' : fr > 0 ? 'short-perp' : 'long-perp';

  return {
    symbol: src.symbol,
    fundingRate: fr,
    aprPct: annualizedFundingPct(fr, src.fundingIntervalHours ?? null),
    basisPct,
    oi: src.openInterestValue,
    nextFundingTime: src.nextFundingTime,
    side,
    mark,
    spot: sp,
  };
}

function suppressDerivedCarry(row: CarryRow): CarryRow {
  return { ...row, aprPct: null, basisPct: null, side: 'flat' };
}

function canonicalInstrument(value: string): string {
  const [base = '', rawQuote = ''] = value.trim().toUpperCase().split('/');
  return rawQuote ? `${base}/${rawQuote.replace(/:.*$/, '')}` : base;
}

/**
 * Join one funding observation with its spot quote and produce inspectable
 * carry evidence. APR/basis/direction fail closed when either required receipt
 * is absent, mismatched, unavailable, stale, or clock-skewed.
 */
export function computeInspectedCarry(
  funding: FundingRow,
  quote: Quote | null,
  evaluatedAtMs: number = Date.now(),
): InspectedCarryRow {
  const computed = computeCarry(funding, quote?.price ?? null);
  const fundingReceipt = funding.receipt;
  const quoteReceipt = quote?.receipt;
  const expected = canonicalInstrument(funding.symbol);
  const congruent =
    quote != null &&
    canonicalInstrument(quote.symbol) === expected &&
    fundingReceipt?.instrument != null &&
    canonicalInstrument(fundingReceipt.instrument) === expected &&
    quoteReceipt?.instrument != null &&
    canonicalInstrument(quoteReceipt.instrument) === expected;

  if (!fundingReceipt || !quoteReceipt || !congruent) {
    return { ...suppressDerivedCarry(computed), receipt: null, actionable: false };
  }

  try {
    const provenance = conservativeDataProvenance([fundingReceipt.provenance, quoteReceipt.provenance]);
    const receipt = deriveDataReceipt(
      {
        providerId: 'midas-web',
        providerVersion: '1.0',
        source: 'Midas client funding-carry reducer',
        venue: fundingReceipt.venue === quoteReceipt.venue ? fundingReceipt.venue : null,
        datasetFamily: 'funding',
        instrument: funding.symbol,
        coverage: 'Funding APR, perp/spot basis, and funding-collecting leg.',
        provenance,
        expectedCadenceMs: 15_000,
        units: {
          aprPct: 'percent/year',
          basisPct: 'percent',
          fundingRate: 'fraction/settlement',
          openInterestValue: 'quote currency',
        },
        methodology: {
          id: 'funding-carry',
          version: '1.0',
          formula:
            'APR=fundingRate*(24/fundingIntervalHours)*365*100; basis=(perpMark/spot-1)*100; positive funding => short perp',
        },
        inputReceipts: [fundingReceipt, quoteReceipt],
        limitations: ['Gross of fees, slippage, borrow costs, transfer costs, and account-specific constraints.'],
        note: provenance === 'live' ? null : `Derived from ${provenance} funding and quote evidence.`,
      },
      evaluatedAtMs,
    );
    const fresh = isReceiptFresh(receipt, evaluatedAtMs) && receipt.provenance !== 'unavailable';
    const row = fresh ? computed : suppressDerivedCarry(computed);
    return { ...row, receipt, actionable: isReceiptActionable(receipt, evaluatedAtMs) };
  } catch {
    return { ...suppressDerivedCarry(computed), receipt: null, actionable: false };
  }
}

export type CarrySortKey = 'symbol' | 'apr' | 'basis' | 'oi';

export function sortCarry<T extends CarryRow>(rows: readonly T[], key: CarrySortKey, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r: T): number | null =>
    key === 'apr' ? r.aprPct : key === 'basis' ? r.basisPct : key === 'oi' ? r.oi : null;
  return [...rows].sort((a, b) => {
    if (key === 'symbol') return a.symbol.localeCompare(b.symbol) * sign;
    return ((value(a) ?? -Infinity) - (value(b) ?? -Infinity)) * sign;
  });
}
