import type { ScreenAggregateBasis, VenueScreenPoint } from '@midas/shared';

/**
 * Say plainly how a row's aggregate was derived.
 *
 * The basis is user-facing rather than internal bookkeeping: a median across
 * venues that report no volume, and a single venue's own number, are weaker
 * claims than a volume-weighted figure. Rendering all three identically would
 * make the column mean three different things without saying so.
 */
export function basisLabel(basis: ScreenAggregateBasis | null): string {
  switch (basis) {
    case 'volume-weighted':
      return 'Quote-volume-weighted across the venues that quote this symbol.';
    case 'median':
      return 'Unweighted median — no venue reported usable volume, so there are no weights to apply.';
    case 'single-venue':
      return 'One venue quotes this symbol; this is that venue’s own figure, not a market aggregate.';
    default:
      return 'No venue priced this symbol.';
  }
}

/** Price disagreement across venues, in basis points. */
export function fmtDispersionBps(bps: number | null): string {
  // Null means "fewer than two venues quote it" — not zero disagreement.
  if (bps === null) return '—';
  if (bps < 1) return '<1';
  return bps >= 100 ? Math.round(bps).toString() : bps.toFixed(1);
}

/** Full per-venue breakdown for a row's hover title. */
export function venuesTitle(venues: VenueScreenPoint[]): string {
  if (venues.length === 0) return 'No venue quoted this symbol.';
  return venues
    .map((v) => {
      const volume = v.quoteVolume === null ? 'volume n/a' : `$${Math.round(v.quoteVolume).toLocaleString('en-US')}`;
      return `${v.exchange} ${v.price} (${volume})`;
    })
    .join('  ·  ');
}
