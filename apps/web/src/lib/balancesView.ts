import {
  conservativeDataProvenance,
  deriveDataReceipt,
  type AccountPositions,
  type Balances,
  type DataReceipt,
} from '@midas/shared';
import { isReceiptActionable, isReceiptFresh } from './receiptView';

/**
 * Pure view helpers for the BAL (balances) module: an honesty badge derived from
 * the snapshot's provenance, and an allocation breakdown across priced holdings.
 * The badge is what keeps the UI honest about whether balances are a real keyed
 * read, a synthetic demo book, or unavailable (no keys configured).
 */
export type BalancesTone = 'live' | 'synthetic' | 'unavailable';

export interface BalancesBadge {
  label: string;
  tone: BalancesTone;
  detail: string;
}

export function balancesBadge(b: Balances): BalancesBadge {
  switch (b.provenance) {
    case 'live':
      return { label: 'live', tone: 'live', detail: b.note ?? `Live read-only balances from ${b.source}.` };
    case 'synthetic':
      return {
        label: 'demo',
        tone: 'synthetic',
        detail: b.note ?? 'Synthetic demo balances — not a real account.',
      };
    default:
      return { label: 'unavailable', tone: 'unavailable', detail: b.note ?? 'Balances unavailable.' };
  }
}

export interface AllocationRow {
  asset: string;
  valueUsd: number;
  /** Share of total priced value, in percent. */
  pct: number;
}

/**
 * Allocation breakdown across priced holdings: each asset's USD value as a % of
 * the total priced value, largest first. Unpriced holdings are excluded (they
 * have no value to allocate). Returns [] when nothing is priced.
 */
export function allocations(b: Balances): AllocationRow[] {
  const priced: Array<{ asset: string; valueUsd: number }> = [];
  for (const x of b.balances) {
    if (x.valueUsd != null && x.valueUsd > 0) priced.push({ asset: x.asset, valueUsd: x.valueUsd });
  }
  const total = priced.reduce((s, x) => s + x.valueUsd, 0);
  if (total <= 0) return [];
  return priced
    .map((x) => ({ asset: x.asset, valueUsd: x.valueUsd, pct: (x.valueUsd / total) * 100 }))
    .sort((a, c) => c.valueUsd - a.valueUsd);
}

export interface InspectedAccountEquity {
  value: number | null;
  receipt: DataReceipt | null;
  actionable: boolean;
}

/** Combine balance value and unrealized P&L only with complete two-input lineage. */
export function inspectAccountEquity(
  balances: Balances | null | undefined,
  positions: AccountPositions | null | undefined,
  evaluatedAtMs: number = Date.now(),
): InspectedAccountEquity {
  if (
    balances?.totalValueUsd == null ||
    positions?.totalUnrealizedPnlUsd == null ||
    !balances.receipt ||
    !positions.receipt
  ) {
    return { value: null, receipt: null, actionable: false };
  }
  try {
    const provenance = conservativeDataProvenance([
      balances.receipt.provenance,
      positions.receipt.provenance,
    ]);
    const receipt = deriveDataReceipt(
      {
        providerId: 'midas-web',
        providerVersion: '1.0',
        source: 'Midas client account-equity reducer',
        venue:
          balances.receipt.venue === positions.receipt.venue ? balances.receipt.venue : null,
        datasetFamily: 'balances',
        instrument: null,
        coverage: 'Priced balances plus open-position unrealized P&L.',
        provenance,
        expectedCadenceMs: 30_000,
        units: { equity: 'USD', totalUnrealizedPnlUsd: 'USD', totalValueUsd: 'USD' },
        methodology: {
          id: 'account-equity',
          version: '1.0',
          formula: 'equity=balances.totalValueUsd+positions.totalUnrealizedPnlUsd',
        },
        inputReceipts: [balances.receipt, positions.receipt],
        limitations: [
          'Balance valuation may be a floor when held assets cannot be priced.',
          'Unrealized P&L depends on venue-reported marks and excludes closed positions.',
        ],
        note: provenance === 'live' ? null : `Derived from ${provenance} account evidence.`,
      },
      evaluatedAtMs,
    );
    const fresh = isReceiptFresh(receipt, evaluatedAtMs) && receipt.provenance !== 'unavailable';
    return {
      value: fresh ? balances.totalValueUsd + positions.totalUnrealizedPnlUsd : null,
      receipt,
      actionable: isReceiptActionable(receipt, evaluatedAtMs),
    };
  } catch {
    return { value: null, receipt: null, actionable: false };
  }
}

export interface InspectedAllocations {
  rows: AllocationRow[];
  receipt: DataReceipt | null;
}

/** Attach the allocation formula to the balance observation it reduces. */
export function inspectAllocations(
  balances: Balances | null | undefined,
  evaluatedAtMs: number = Date.now(),
): InspectedAllocations {
  if (!balances?.receipt) return { rows: [], receipt: null };
  const rows = allocations(balances);
  try {
    const receipt = deriveDataReceipt(
      {
        providerId: 'midas-web',
        providerVersion: '1.0',
        source: 'Midas client balance-allocation reducer',
        venue: balances.receipt.venue,
        datasetFamily: 'balances',
        instrument: null,
        coverage: `${rows.length} priced asset allocation(s).`,
        provenance: balances.receipt.provenance,
        expectedCadenceMs: 30_000,
        units: { allocation: 'percent', valueUsd: 'USD' },
        methodology: {
          id: 'balance-allocation',
          version: '1.0',
          formula: 'allocationPct=asset.valueUsd/sum(reported positive asset.valueUsd)*100',
        },
        inputReceipts: [balances.receipt],
        limitations: ['Assets without a reported USD value are excluded from the allocation denominator.'],
        note:
          balances.receipt.provenance === 'live'
            ? null
            : `Derived from ${balances.receipt.provenance} balance evidence.`,
      },
      evaluatedAtMs,
    );
    const usable = isReceiptFresh(receipt, evaluatedAtMs) && receipt.provenance !== 'unavailable';
    return { rows: usable ? rows : [], receipt };
  } catch {
    return { rows: [], receipt: null };
  }
}
