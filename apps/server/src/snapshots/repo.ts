import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from '../persist';

/** Owner for single-user / auth-off deploys (and pre-auth snapshots). */
const LOCAL = '@local';
const ownerKey = (userId?: string): string => userId || LOCAL;

/** A stored snapshot: the client blob plus when the server last took it. */
export interface UserSnapshot {
  /** Opaque client payload. The server never reads inside. */
  blob: unknown;
  /** Server clock at the moment of the write — the sync conflict tiebreaker. */
  updatedAt: number;
}

type Store = Record<string, UserSnapshot>;

/**
 * Stores one opaque snapshot per user. The server treats the payload as a black
 * box — the client owns its shape — so this layer only scopes by owner, stamps
 * a server time, and persists. Backed by a JSON file when a path is given
 * (survives restarts); in-memory otherwise (tests). With auth off, everything
 * lives under the `@local` owner (unchanged single-user behaviour).
 *
 * Shared by the per-user workspace and portfolio stores, which differ only in
 * the file they persist to.
 */
export class UserSnapshotRepo {
  private store: Store = {};

  constructor(private readonly file?: string) {
    if (file) this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (data && typeof data === 'object') this.store = data as Store;
    } catch {
      /* corrupt store → start fresh */
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      writeFileAtomic(this.file, JSON.stringify(this.store, null, 2));
    } catch {
      /* best-effort */
    }
  }

  /** The user's snapshot, or null if they've never pushed one. */
  get(userId?: string): UserSnapshot | null {
    return this.store[ownerKey(userId)] ?? null;
  }

  /** Replace the user's snapshot with a fresh client blob, stamped `now`. */
  set(userId: string | undefined, blob: unknown, now: number): UserSnapshot {
    const snapshot: UserSnapshot = { blob, updatedAt: now };
    this.store[ownerKey(userId)] = snapshot;
    this.persist();
    return snapshot;
  }
}
