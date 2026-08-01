import {
  deriveDataReceipt,
  type DataReceipt,
  type FundingRow,
} from '@midas/shared';
import { isReceiptActionable, isReceiptFresh } from './receiptView';

/**
 * Annualized funding rate as a percent. Pass the venue's actual settlement
 * interval: funding cadence varies by venue (1h on Hyperliquid-style venues,
 * 4h on some perps, 8h commonly) and the APR scales with it — an 8h assumption
 * can be off by 2-8x. Pass null when the interval is unknown → null out (honest
 * beats helpful). null rate in → null out.
 */
export function annualizedFundingPct(rate: number | null, intervalHours: number | null): number | null {
  if (rate == null || intervalHours === null) return null;
  const hours = intervalHours;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return rate * (24 / hours) * 365 * 100;
}

export interface InspectedFundingRow {
  row: FundingRow;
  annualizedPct: number | null;
  receipt: DataReceipt | null;
  actionable: boolean;
}

/** Annualize one funding row without hiding its formula or input evidence. */
export function inspectFundingRow(
  row: FundingRow,
  evaluatedAtMs: number = Date.now(),
): InspectedFundingRow {
  const annualizedPct = annualizedFundingPct(row.fundingRate, row.fundingIntervalHours ?? null);
  if (!row.receipt) return { row, annualizedPct: null, receipt: null, actionable: false };
  try {
    const receipt = deriveDataReceipt(
      {
        providerId: 'midas-web',
        providerVersion: '1.0',
        source: 'Midas client funding annualizer',
        venue: row.receipt.venue,
        datasetFamily: 'funding',
        instrument: row.symbol,
        coverage: 'Funding board row with annualized rate.',
        provenance: row.receipt.provenance,
        expectedCadenceMs: 15_000,
        units: { annualizedPct: 'percent/year', fundingRate: 'fraction/settlement' },
        methodology: {
          id: 'funding-annualized',
          version: '1.0',
          formula: 'annualizedPct=fundingRate*(24/fundingIntervalHours)*365*100',
        },
        inputReceipts: [row.receipt],
        limitations:
          row.fundingIntervalHours == null
            ? ['Funding settlement cadence is unknown; annualized funding is unavailable.']
            : [],
        note:
          row.receipt.provenance === 'live'
            ? null
            : `Derived from ${row.receipt.provenance} funding evidence.`,
      },
      evaluatedAtMs,
    );
    const fresh = isReceiptFresh(receipt, evaluatedAtMs) && receipt.provenance !== 'unavailable';
    return {
      row,
      annualizedPct: fresh ? annualizedPct : null,
      receipt,
      actionable: isReceiptActionable(receipt, evaluatedAtMs),
    };
  } catch {
    return { row, annualizedPct: null, receipt: null, actionable: false };
  }
}

export type FundingSortKey = 'symbol' | 'funding' | 'oi';

/** Sort funding rows by a column; numeric nulls always sink to the bottom. */
export function sortFundingRows(
  rows: FundingRow[],
  key: FundingSortKey,
  dir: 'asc' | 'desc',
): FundingRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const num = (r: FundingRow): number | null => (key === 'funding' ? r.fundingRate : r.openInterestValue);
  return [...rows].sort((a, b) => {
    if (key === 'symbol') return sign * a.symbol.localeCompare(b.symbol);
    const av = num(a);
    const bv = num(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last regardless of direction
    if (bv == null) return -1;
    return sign * (av - bv);
  });
}
