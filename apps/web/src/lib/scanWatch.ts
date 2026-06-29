/**
 * Scan-watch helpers: turn a saved-scan criteria set into the list of symbols
 * that currently match, and diff that list against the last-seen set to find
 * *newly* matched names worth notifying about. Pure and synchronous — the
 * background loop (ScanWatchEngine) supplies the rows and holds the baseline.
 */
import type { SignalRow, ScanCriteria } from './signals';
import { filterSignals } from './signals';

const base = (sym: string) => sym.replace(/\/.*$/, '');

/** Symbols currently matching a scan's criteria, sorted for stable diffing. */
export function matchingSymbols(rows: SignalRow[], c: ScanCriteria): string[] {
  return filterSignals(rows, c)
    .map((r) => r.symbol)
    .sort();
}

/** Symbols in `curr` that were not in `prev` — the newly-matched names to alert on. */
export function newMatches(prev: string[], curr: string[]): string[] {
  const before = new Set(prev);
  return curr.filter((s) => !before.has(s));
}

/** Notification title for a batch of new matches under a watched scan. */
export function watchHeadline(name: string, fresh: string[]): string {
  return `Scan “${name}”: ${fresh.length} new ${fresh.length === 1 ? 'match' : 'matches'}`;
}

/** Notification body — base symbols, truncated with a "+N more" tail. */
export function watchBody(fresh: string[], max = 6): string {
  const shown = fresh.slice(0, max).map(base);
  const extra = fresh.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ');
}
