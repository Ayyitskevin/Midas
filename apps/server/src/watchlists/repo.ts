import { UserSnapshotRepo } from '../snapshots/repo';

/**
 * Per-user watchlist snapshots (named lists + their symbols). An opaque blob the
 * client owns — see {@link UserSnapshotRepo} for the storage model (owner
 * scoping, `@local` when auth is off, optional file backing).
 */
export class WatchlistRepo extends UserSnapshotRepo {}
