import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Owner for single-user / auth-off deploys (and pre-auth snapshots). */
const LOCAL = '@local';
const ownerKey = (userId?: string): string => userId || LOCAL;

/** A stored snapshot: the client layout blob plus when the server last took it. */
export interface WorkspaceSnapshot {
  /** Opaque client payload (panels, layouts, active symbol…). Server never reads inside. */
  blob: unknown;
  /** Server clock at the moment of the write — the sync conflict tiebreaker. */
  updatedAt: number;
}

type Store = Record<string, WorkspaceSnapshot>;

/**
 * Stores one opaque workspace snapshot per user. The server treats the payload
 * as a black box — the client owns its shape — so this layer only scopes by
 * owner, stamps a server time, and persists. Backed by a JSON file when a path
 * is given (survives restarts); in-memory otherwise (tests). With auth off,
 * everything lives under the `@local` owner (unchanged single-user behaviour).
 */
export class WorkspaceRepo {
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
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.store, null, 2));
    } catch {
      /* best-effort */
    }
  }

  /** The user's snapshot, or null if they've never pushed one. */
  get(userId?: string): WorkspaceSnapshot | null {
    return this.store[ownerKey(userId)] ?? null;
  }

  /** Replace the user's snapshot with a fresh client blob, stamped `now`. */
  set(userId: string | undefined, blob: unknown, now: number): WorkspaceSnapshot {
    const snapshot: WorkspaceSnapshot = { blob, updatedAt: now };
    this.store[ownerKey(userId)] = snapshot;
    this.persist();
    return snapshot;
  }
}
