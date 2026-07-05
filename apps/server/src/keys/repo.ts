import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from '../persist';
import { decryptText, encryptText } from './crypto';

/**
 * Per-user exchange keys, encrypted at rest — the hosted-tier groundwork
 * from docs/HOSTED_KEYS_DESIGN.md. File-backed like every other repo (a
 * hosted deployment swaps the file for its DB adapter); every secret field
 * is AES-256-GCM ciphertext on disk, decrypted only at the moment a
 * per-user provider is constructed. Nothing in this module logs, and only
 * {@link KeyRepo.metaFor} data ever leaves the server.
 */

export interface UserExchangeKeys {
  /** ccxt exchange id, e.g. 'binance'. */
  exchange: string;
  apiKey: string;
  secret: string;
  password?: string;
  /** User explicitly marked the key as trade-permissioned — required by the per-user trading gate. */
  canTrade: boolean;
}

/** The only shape the API ever returns — no secret material. */
export interface UserKeysMeta {
  exchange: string;
  /** Last 4 characters of the API key, for "which key is this" recognition. */
  keyLast4: string;
  canTrade: boolean;
  createdAt: number;
}

interface StoredRecord {
  exchange: string;
  apiKeyEnc: string;
  secretEnc: string;
  passwordEnc?: string;
  keyLast4: string;
  canTrade: boolean;
  createdAt: number;
}

export class KeyRepo {
  private records: Record<string, StoredRecord> = {};

  constructor(
    private readonly kmsSecret: string,
    private readonly file?: string,
  ) {
    if (file) this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { records?: Record<string, StoredRecord> };
      if (data.records && typeof data.records === 'object') this.records = data.records;
    } catch {
      /* corrupt store → start fresh (keys are re-enterable) */
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      writeFileAtomic(this.file, JSON.stringify({ records: this.records }));
    } catch {
      /* best-effort */
    }
  }

  set(userId: string, keys: UserExchangeKeys, now: number): UserKeysMeta {
    const record: StoredRecord = {
      exchange: keys.exchange.toLowerCase(),
      apiKeyEnc: encryptText(keys.apiKey, this.kmsSecret),
      secretEnc: encryptText(keys.secret, this.kmsSecret),
      ...(keys.password ? { passwordEnc: encryptText(keys.password, this.kmsSecret) } : {}),
      keyLast4: keys.apiKey.slice(-4),
      canTrade: Boolean(keys.canTrade),
      createdAt: now,
    };
    this.records[userId] = record;
    this.persist();
    return this.metaFor(userId)!;
  }

  /** Decrypted credentials — for provider construction ONLY, never for a response. */
  get(userId: string): UserExchangeKeys | null {
    const r = this.records[userId];
    if (!r) return null;
    const apiKey = decryptText(r.apiKeyEnc, this.kmsSecret);
    const secret = decryptText(r.secretEnc, this.kmsSecret);
    if (apiKey == null || secret == null) return null; // tampered / wrong KMS secret
    const password = r.passwordEnc ? decryptText(r.passwordEnc, this.kmsSecret) : undefined;
    return {
      exchange: r.exchange,
      apiKey,
      secret,
      ...(password ? { password } : {}),
      canTrade: r.canTrade,
    };
  }

  metaFor(userId: string): UserKeysMeta | null {
    const r = this.records[userId];
    if (!r) return null;
    return { exchange: r.exchange, keyLast4: r.keyLast4, canTrade: r.canTrade, createdAt: r.createdAt };
  }

  /** Every user with stored keys — for boot-time per-user loop startup. */
  userIds(): string[] {
    return Object.keys(this.records);
  }

  remove(userId: string): boolean {
    if (!this.records[userId]) return false;
    delete this.records[userId];
    this.persist();
    return true;
  }
}
