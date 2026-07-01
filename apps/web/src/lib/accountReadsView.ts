import type { AccountFills, AccountProvenance, AccountPositions, OpenOrders } from '@midas/shared';

/**
 * Pure view helpers for the read-only account panels (ORD open orders, POSN
 * positions): an honesty badge derived from the snapshot's provenance. The badge
 * keeps the UI honest about whether the data is a real keyed read, a synthetic
 * demo set, or unavailable (no keys / unsupported / error).
 */
export type AccountTone = 'live' | 'synthetic' | 'unavailable';

export interface AccountBadge {
  label: string;
  tone: AccountTone;
  detail: string;
}

/** Shared provenance → tone mapping, with per-feed labels and a fallback detail. */
function badge(
  provenance: AccountProvenance,
  note: string | null,
  liveLabel: string,
  liveDetail: string,
  syntheticDetail: string,
): AccountBadge {
  switch (provenance) {
    case 'live':
      return { label: liveLabel, tone: 'live', detail: note ?? liveDetail };
    case 'synthetic':
      return { label: 'demo', tone: 'synthetic', detail: note ?? syntheticDetail };
    default:
      return { label: 'unavailable', tone: 'unavailable', detail: note ?? 'Unavailable.' };
  }
}

export function ordersBadge(o: OpenOrders): AccountBadge {
  return badge(
    o.provenance,
    o.note,
    'live',
    `Live read-only open orders from ${o.source}.`,
    'Synthetic demo orders — not a real account.',
  );
}

export function positionsBadge(p: AccountPositions): AccountBadge {
  return badge(
    p.provenance,
    p.note,
    'live',
    `Live read-only positions from ${p.source}.`,
    'Synthetic demo positions — not a real account.',
  );
}

export function fillsBadge(f: AccountFills): AccountBadge {
  return badge(
    f.provenance,
    f.note,
    'live',
    `Live read-only fills from ${f.source}.`,
    'Synthetic demo fills — not a real account.',
  );
}
