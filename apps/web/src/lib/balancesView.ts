import type { Balances } from '@midas/shared';

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
