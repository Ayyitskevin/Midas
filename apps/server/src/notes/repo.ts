import { UserSnapshotRepo } from '../snapshots/repo';

/**
 * Per-user notes snapshots (free-form market notes, keyed global or per-symbol).
 * An opaque blob the client owns — see {@link UserSnapshotRepo} for the storage
 * model (owner scoping, `@local` when auth is off, optional file backing).
 */
export class NotesRepo extends UserSnapshotRepo {}
