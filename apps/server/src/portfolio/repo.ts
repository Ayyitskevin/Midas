import { UserSnapshotRepo } from '../snapshots/repo';

/**
 * Per-user paper-portfolio snapshots (positions, transactions, realized P&L).
 * An opaque blob the client owns — see {@link UserSnapshotRepo} for the storage
 * model (owner scoping, `@local` when auth is off, optional file backing).
 */
export class PortfolioRepo extends UserSnapshotRepo {}
