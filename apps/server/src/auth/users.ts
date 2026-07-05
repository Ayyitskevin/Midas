import { existsSync, readFileSync } from 'node:fs';
import type { User } from '@midas/shared';
import { writeFileAtomic } from '../persist';

export interface StoredUser extends User {
  passwordHash: string;
  /** Bumped to revoke all previously-issued tokens (sign out other devices). */
  tokenVersion: number;
  isAdmin: boolean;
}

/** Strip secret material for API responses. */
export function toPublic(u: StoredUser): User {
  return { id: u.id, username: u.username, createdAt: u.createdAt, isAdmin: u.isAdmin };
}

/** File-backed user store (in-memory when no path is given, for tests). */
export class UserRepo {
  private users: StoredUser[] = [];
  private seq = 0;

  constructor(private readonly file?: string) {
    if (file) this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { users?: StoredUser[] };
      // Fail CLOSED on a present-but-structurally-invalid store too — valid JSON
      // that isn't {users:[...]} (e.g. {"users":null}, {}, a bare array). Without
      // this it would parse fine, skip the block, and silently leave an empty
      // store: the exact wipe + admin-reopen the catch below guards against.
      if (!Array.isArray(data.users)) {
        throw new Error('missing a valid `users` array');
      }
      // Normalise records written before token versions / admin existed.
      this.users = data.users.map((u) => ({
        ...u,
        tokenVersion: typeof u.tokenVersion === 'number' ? u.tokenVersion : 0,
        isAdmin: Boolean(u.isAdmin),
      }));
      // Bootstrap: if no admin exists, promote the earliest-created user.
      if (this.users.length > 0 && !this.users.some((u) => u.isAdmin)) {
        const earliest = this.users.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
        earliest.isAdmin = true;
        this.persist();
      }
    } catch (err) {
      // Fail CLOSED on a present-but-unparseable user store. Silently resetting
      // to empty would wipe every account AND re-open admin bootstrap (with the
      // store empty, count()===0 makes canSignup true and the next signup becomes
      // admin) — turning a routine write interruption into an auth wipe + admin
      // takeover, even with MIDAS_AUTH_ALLOW_SIGNUP=false. Abort startup so an
      // operator restores the file instead of losing it.
      throw new Error(
        `User store at ${this.file} is present but unreadable ` +
          `(${err instanceof Error ? err.message : 'parse error'}). Refusing to start with an ` +
          `empty store — restore the file or move it aside to bootstrap a fresh one.`,
      );
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      writeFileAtomic(this.file, JSON.stringify({ users: this.users }, null, 2));
    } catch {
      /* best-effort */
    }
  }

  count(): number {
    return this.users.length;
  }

  /** Every user as public records, oldest first (admin list). */
  list(): User[] {
    return [...this.users].sort((a, b) => a.createdAt - b.createdAt).map(toPublic);
  }

  findByUsername(username: string): StoredUser | undefined {
    const u = username.trim().toLowerCase();
    return this.users.find((x) => x.username.toLowerCase() === u);
  }

  findById(id: string): StoredUser | undefined {
    return this.users.find((x) => x.id === id);
  }

  create(username: string, passwordHash: string, now: number): StoredUser {
    this.seq += 1;
    const user: StoredUser = {
      id: `usr_${now.toString(36)}_${this.seq.toString(36)}`,
      username: username.trim(),
      passwordHash,
      createdAt: now,
      tokenVersion: 0,
      isAdmin: this.users.length === 0, // the first account bootstraps as admin
    };
    this.users = [...this.users, user];
    this.persist();
    return user;
  }

  /** Replace a user's password hash and rotate their token version. */
  setPassword(id: string, passwordHash: string): StoredUser | undefined {
    const user = this.findById(id);
    if (!user) return undefined;
    user.passwordHash = passwordHash;
    user.tokenVersion += 1;
    this.persist();
    return user;
  }

  /** Bump a user's token version, invalidating all existing tokens. */
  rotateToken(id: string): StoredUser | undefined {
    const user = this.findById(id);
    if (!user) return undefined;
    user.tokenVersion += 1;
    this.persist();
    return user;
  }

  /** Remove a user. Returns true if one was removed. */
  remove(id: string): boolean {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    const removed = this.users.length !== before;
    if (removed) this.persist();
    return removed;
  }
}
