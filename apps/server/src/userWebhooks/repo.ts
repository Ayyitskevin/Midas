import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type {
  AccountWebhookDeliveryStatus,
  AccountWebhookFailureCategory,
  AccountWebhookMeta,
} from '@midas/shared';
import { writeFileAtomic } from '../persist';
import { decryptText, encryptText } from '../keys/crypto';
import { MAX_USER_WEBHOOK_URL_LENGTH } from './url';

interface StoredDelivery extends AccountWebhookDeliveryStatus {
  /** Internal correlation only; never returned or logged. */
  attemptId: string;
}

interface StoredWebhookRecord {
  urlEnc: string;
  /** Random configuration generation; binds queued jobs to one exact target. */
  targetId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastDelivery: StoredDelivery | null;
  /** Latest cadence-window end durably claimed (claim-before-send). */
  lastDigestWindowEnd: number;
}

interface StoredWebhookFile {
  schemaVersion: 1;
  records: Record<string, StoredWebhookRecord>;
}

export class UserWebhookStoreError extends Error {
  override readonly name = 'UserWebhookStoreError';

  constructor() {
    // Fixed text only: never include the configured path or parse contents.
    super('Per-user webhook state is unavailable; delivery is disabled until the store is repaired.');
  }
}

const FAILURE_CATEGORIES = new Set<AccountWebhookFailureCategory>([
  'blocked-target',
  'capacity',
  'configuration',
  'dns',
  'http-4xx',
  'http-5xx',
  'malformed-response',
  'network',
  'queue-full',
  'redirect',
  'timeout',
]);
const MAX_WEBHOOK_CIPHERTEXT_LENGTH = 8_192;

interface EncryptedWebhookEnvelope {
  kind: 'midas-user-webhook-v1';
  userId: string;
  url: string;
}

function encryptWebhookUrl(userId: string, url: string, kmsSecret: string): string {
  const envelope: EncryptedWebhookEnvelope = { kind: 'midas-user-webhook-v1', userId, url };
  return encryptText(JSON.stringify(envelope), kmsSecret);
}

function decryptWebhookUrl(stored: string, userId: string, kmsSecret: string): string | null {
  const plain = decryptText(stored, kmsSecret);
  if (!plain) return null;
  try {
    const envelope = JSON.parse(plain) as Partial<EncryptedWebhookEnvelope>;
    return envelope.kind === 'midas-user-webhook-v1' &&
      envelope.userId === userId &&
      typeof envelope.url === 'string'
      ? envelope.url
      : null;
  } catch {
    return null;
  }
}

function validDelivery(value: unknown): value is StoredDelivery {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<StoredDelivery>;
  const categoryValid =
    (d.outcome === 'pending' || d.outcome === 'delivered')
      ? d.failureCategory === null
      : d.outcome === 'failed' &&
        typeof d.failureCategory === 'string' &&
        FAILURE_CATEGORIES.has(d.failureCategory as AccountWebhookFailureCategory);
  return (
    (d.kind === 'fills' || d.kind === 'digest') &&
    (d.outcome === 'pending' || d.outcome === 'delivered' || d.outcome === 'failed') &&
    categoryValid &&
    typeof d.at === 'number' &&
    Number.isFinite(d.at) &&
    typeof d.attemptId === 'string' &&
    d.attemptId.length > 0 &&
    d.attemptId.length <= 128
  );
}

function validRecord(value: unknown): value is StoredWebhookRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<StoredWebhookRecord>;
  return (
    typeof r.urlEnc === 'string' &&
    r.urlEnc.length > 0 &&
    r.urlEnc.length <= MAX_WEBHOOK_CIPHERTEXT_LENGTH &&
    typeof r.targetId === 'string' &&
    /^[a-f0-9]{32}$/.test(r.targetId) &&
    typeof r.enabled === 'boolean' &&
    typeof r.createdAt === 'number' &&
    Number.isFinite(r.createdAt) &&
    typeof r.updatedAt === 'number' &&
    Number.isFinite(r.updatedAt) &&
    validDelivery(r.lastDelivery) &&
    typeof r.lastDigestWindowEnd === 'number' &&
    Number.isFinite(r.lastDigestWindowEnd) &&
    r.lastDigestWindowEnd >= 0
  );
}

const validTime = (value: number): boolean => Number.isFinite(value) && value >= 0;
const validAttemptId = (value: string): boolean => value.length > 0 && value.length <= 128;

/**
 * Narrow encrypted store for the personal-webhook feature. It is intentionally
 * not a generic settings subsystem. The URL is ciphertext; only metadata and
 * the durable digest watermark remain in plaintext.
 *
 * Configuration mutations and digest claims fail loudly. A digest claim that
 * was not durably written is not safe to send because a restart could repeat
 * it. Ordinary delivery status stays memory-only so outbound failure handling
 * never fsync-blocks account reads.
 */
export class UserWebhookRepo {
  private records: Record<string, StoredWebhookRecord> = {};

  constructor(
    private readonly kmsSecret: string,
    private readonly file?: string,
  ) {
    if (file) this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredWebhookFile>;
      if (
        data.schemaVersion !== 1 ||
        !data.records ||
        typeof data.records !== 'object' ||
        Array.isArray(data.records)
      ) {
        throw new UserWebhookStoreError();
      }
      for (const value of Object.values(data.records)) {
        if (!validRecord(value)) throw new UserWebhookStoreError();
      }
      this.records = data.records;
    } catch (error) {
      if (error instanceof UserWebhookStoreError) throw error;
      throw new UserWebhookStoreError();
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      writeFileAtomic(this.file, JSON.stringify({ schemaVersion: 1, records: this.records }));
    } catch {
      throw new UserWebhookStoreError();
    }
  }

  private commit(userId: string, next: StoredWebhookRecord | null): void {
    const previous = this.records[userId];
    if (next) this.records[userId] = next;
    else delete this.records[userId];
    try {
      this.persist();
    } catch (error) {
      if (previous) this.records[userId] = previous;
      else delete this.records[userId];
      throw error;
    }
  }

  configure(userId: string, canonicalUrl: string, now: number, currentWindowEnd: number): AccountWebhookMeta {
    if (
      typeof canonicalUrl !== 'string' ||
      canonicalUrl.length === 0 ||
      canonicalUrl.length > MAX_USER_WEBHOOK_URL_LENGTH ||
      Buffer.byteLength(canonicalUrl) > MAX_USER_WEBHOOK_URL_LENGTH ||
      !validTime(now) ||
      !validTime(currentWindowEnd)
    ) throw new UserWebhookStoreError();
    const previous = this.records[userId];
    const urlEnc = encryptWebhookUrl(userId, canonicalUrl, this.kmsSecret);
    if (urlEnc.length > MAX_WEBHOOK_CIPHERTEXT_LENGTH) throw new UserWebhookStoreError();
    const next: StoredWebhookRecord = {
      // The authenticated owner is inside the GCM-protected envelope. Moving a
      // valid ciphertext to another record therefore fails closed instead of
      // routing one tenant's account payload to another tenant's endpoint.
      urlEnc,
      targetId: randomBytes(16).toString('hex'),
      // Every create/replace is safe by default. The user must explicitly
      // enable the newly stored target in a separate authenticated action.
      enabled: false,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastDelivery: null,
      // Do not backfill a cadence window that completed before this endpoint
      // was configured. This is also the clear/re-add duplicate guard.
      lastDigestWindowEnd: Math.max(previous?.lastDigestWindowEnd ?? 0, currentWindowEnd),
    };
    this.commit(userId, next);
    return this.metaFor(userId)!;
  }

  urlFor(userId: string): string | null {
    const record = this.records[userId];
    return record ? decryptWebhookUrl(record.urlEnc, userId, this.kmsSecret) : null;
  }

  /** Exact target snapshot used by an already-queued delivery. */
  deliveryTarget(userId: string): { url: string; targetId: string } | null {
    const record = this.records[userId];
    if (!record?.enabled) return null;
    const url = decryptWebhookUrl(record.urlEnc, userId, this.kmsSecret);
    return url ? { url, targetId: record.targetId } : null;
  }

  /** Reject old jobs after replace, clear/re-add, or disable. */
  matchesEnabledTarget(userId: string, targetId: string): boolean {
    const record = this.records[userId];
    return record?.enabled === true && record.targetId === targetId;
  }

  metaFor(userId: string): AccountWebhookMeta | null {
    const r = this.records[userId];
    if (!r) return null;
    const lastDelivery: AccountWebhookDeliveryStatus | null = r.lastDelivery
      ? {
          kind: r.lastDelivery.kind,
          outcome: r.lastDelivery.outcome,
          failureCategory: r.lastDelivery.failureCategory,
          at: r.lastDelivery.at,
        }
      : null;
    return {
      enabled: r.enabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastDelivery,
    };
  }

  setEnabled(userId: string, enabled: boolean, now: number, currentWindowEnd: number): AccountWebhookMeta | null {
    if (!validTime(now) || !validTime(currentWindowEnd)) throw new UserWebhookStoreError();
    const r = this.records[userId];
    if (!r) return null;
    this.commit(userId, {
      ...r,
      enabled,
      updatedAt: now,
      // Enabling never catches up windows from while delivery was disabled.
      lastDigestWindowEnd: enabled ? Math.max(r.lastDigestWindowEnd, currentWindowEnd) : r.lastDigestWindowEnd,
    });
    return this.metaFor(userId);
  }

  enabled(userId: string): boolean {
    return this.records[userId]?.enabled === true;
  }

  /** Generation token captured synchronously when a delivery enters the queue. */
  enabledTargetId(userId: string): string | null {
    const record = this.records[userId];
    return record?.enabled ? record.targetId : null;
  }

  enabledUserIds(): string[] {
    return Object.entries(this.records)
      .filter(([, record]) => record.enabled)
      .map(([userId]) => userId)
      .sort();
  }

  enabledCount(): number {
    return this.enabledUserIds().length;
  }

  /** Record an ordinary (fill-batch) attempt before it enters the queue. */
  beginDelivery(userId: string, kind: 'fills' | 'digest', attemptId: string, now: number): boolean {
    if ((kind !== 'fills' && kind !== 'digest') || !validAttemptId(attemptId) || !validTime(now)) return false;
    const r = this.records[userId];
    if (!r?.enabled) return false;
    // Ordinary delivery status is observability, not idempotency authority.
    // Keep it memory-only so a slow/full disk cannot fsync-block account reads.
    this.records[userId] = {
      ...r,
      lastDelivery: { kind, outcome: 'pending', failureCategory: null, at: now, attemptId },
    };
    return true;
  }

  /**
   * Atomically claim a completed digest window before any account read or POST.
   * A persisted pending result after a crash is intentionally not retried.
   */
  claimDigest(userId: string, windowEnd: number, attemptId: string, now: number): boolean {
    if (
      !Number.isFinite(windowEnd) ||
      windowEnd < 0 ||
      !Number.isFinite(now) ||
      now < 0 ||
      typeof attemptId !== 'string' ||
      !validAttemptId(attemptId)
    ) {
      return false;
    }
    const r = this.records[userId];
    if (!r?.enabled || r.lastDigestWindowEnd >= windowEnd) return false;
    this.commit(userId, {
      ...r,
      lastDigestWindowEnd: windowEnd,
      lastDelivery: {
        kind: 'digest',
        outcome: 'pending',
        failureCategory: null,
        at: now,
        attemptId,
      },
    });
    return true;
  }

  finishDelivery(
    userId: string,
    attemptId: string,
    outcome: 'delivered' | 'failed',
    category: AccountWebhookFailureCategory | null,
    now: number,
  ): boolean {
    if (
      (outcome !== 'delivered' && outcome !== 'failed') ||
      !validAttemptId(attemptId) ||
      !validTime(now) ||
      (outcome === 'delivered' ? category !== null : category == null || !FAILURE_CATEGORIES.has(category))
    ) {
      return false;
    }
    const r = this.records[userId];
    // A slow older completion must not overwrite a newer attempt's status.
    if (!r?.lastDelivery || r.lastDelivery.attemptId !== attemptId) return false;
    this.records[userId] = {
      ...r,
      lastDelivery: { ...r.lastDelivery, outcome, failureCategory: category, at: now },
    };
    return true;
  }

  noteFailure(
    userId: string,
    kind: 'fills' | 'digest',
    category: AccountWebhookFailureCategory,
    attemptId: string,
    now: number,
  ): boolean {
    if (
      (kind !== 'fills' && kind !== 'digest') ||
      !validAttemptId(attemptId) ||
      !validTime(now) ||
      !FAILURE_CATEGORIES.has(category)
    ) return false;
    const r = this.records[userId];
    if (!r) return false;
    this.records[userId] = {
      ...r,
      lastDelivery: { kind, outcome: 'failed', failureCategory: category, at: now, attemptId },
    };
    return true;
  }

  remove(userId: string): boolean {
    if (!this.records[userId]) return false;
    this.commit(userId, null);
    return true;
  }
}
