import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { User } from '@midas/shared';

export interface StoredUser extends User {
  passwordHash: string;
}

/** Strip secret material for API responses. */
export function toPublic(u: StoredUser): User {
  return { id: u.id, username: u.username, createdAt: u.createdAt };
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
      if (Array.isArray(data.users)) this.users = data.users;
    } catch {
      /* corrupt store → start fresh */
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ users: this.users }, null, 2));
    } catch {
      /* best-effort */
    }
  }

  count(): number {
    return this.users.length;
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
    };
    this.users = [...this.users, user];
    this.persist();
    return user;
  }
}
