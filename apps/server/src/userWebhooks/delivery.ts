import type { AccountWebhookFailureCategory } from '@midas/shared';
import type { UserWebhookRepo } from './repo';
import { resolveWebhookTarget, WebhookUrlError, type WebhookResolver } from './url';
import {
  PinnedHttpsWebhookTransport,
  UserWebhookTransportError,
  type UserWebhookTransport,
} from './transport';
import type { DigestWebhookPayload, FillWebhookPayload } from './payload';

export type UserWebhookPayload = FillWebhookPayload | DigestWebhookPayload;
type DeliveryKind = 'fills' | 'digest';

interface DeliveryJob {
  userId: string;
  kind: DeliveryKind;
  payload: UserWebhookPayload;
  /** Exact endpoint generation that was enabled when this job was queued. */
  targetId: string;
  /** Digest claims are persisted by the scheduler before composition/enqueue. */
  preclaimed: boolean;
}

export interface UserWebhookDeliveryResult {
  kind: DeliveryKind;
  outcome: 'delivered' | 'failed';
  category: AccountWebhookFailureCategory | null;
}

export interface UserWebhookDispatcher {
  enqueue(userId: string, payload: UserWebhookPayload, preclaimed?: boolean): 'queued' | 'disabled' | 'full';
  /** Test/controlled-shutdown seam; production delivery remains fire-and-forget. */
  whenIdle(): Promise<void>;
  pending(): number;
}

function kindFor(payload: UserWebhookPayload): DeliveryKind {
  return payload.type === 'midas.account.fills' ? 'fills' : 'digest';
}

function categoryForStatus(statusCode: number | null): AccountWebhookFailureCategory | null {
  if (statusCode == null || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return 'malformed-response';
  }
  if (statusCode >= 200 && statusCode < 300) return null;
  if (statusCode >= 300 && statusCode < 400) return 'redirect';
  if (statusCode >= 400 && statusCode < 500) return 'http-4xx';
  return 'http-5xx';
}

/** Bounded, no-retry delivery queue shared by every keyed user. */
export function createUserWebhookDispatcher(deps: {
  repo: UserWebhookRepo;
  resolver?: WebhookResolver;
  transport?: UserWebhookTransport;
  maxConcurrent?: number;
  maxPending?: number;
  now?: () => number;
  /** Fail closed for deleted/revoked owners before reads and again before POST. */
  isUserActive?: (userId: string) => boolean;
  /** Sanitized operational hook: no URL, user id, payload, or raw error. */
  onResult?: (result: UserWebhookDeliveryResult) => void;
}): UserWebhookDispatcher {
  const transport = deps.transport ?? new PinnedHttpsWebhookTransport();
  const now = deps.now ?? Date.now;
  const maxConcurrent = Math.max(1, Math.floor(deps.maxConcurrent ?? 4));
  const maxPending = Math.max(1, Math.floor(deps.maxPending ?? 100));
  const queue: DeliveryJob[] = [];
  const idleWaiters: Array<() => void> = [];
  let active = 0;
  let drainScheduled = false;

  const isUserActive = (userId: string): boolean => {
    try {
      return deps.isUserActive?.(userId) ?? true;
    } catch {
      // Auth-state lookup is an isolation boundary, so uncertainty is denial.
      return false;
    }
  };

  const settleIdle = (): void => {
    if (active !== 0 || queue.length !== 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const report = (result: UserWebhookDeliveryResult): void => {
    try {
      deps.onResult?.(result);
    } catch {
      // Logging/metrics hooks are not delivery authority.
    }
  };

  const finishFailure = (
    job: DeliveryJob,
    category: AccountWebhookFailureCategory,
  ): void => {
    try {
      deps.repo.finishDelivery(job.userId, job.payload.deliveryId, 'failed', category, now());
    } catch {
      // The pending/claimed durable record is safer than a retry. Never turn a
      // status-write failure into a second outbound attempt.
    }
    report({ kind: job.kind, outcome: 'failed', category });
  };

  const run = async (job: DeliveryJob): Promise<void> => {
    try {
      if (
        !isUserActive(job.userId) ||
        !deps.repo.matchesEnabledTarget(job.userId, job.targetId)
      ) {
        finishFailure(job, 'configuration');
        return;
      }
      if (!job.preclaimed) {
        try {
          if (!deps.repo.beginDelivery(job.userId, job.kind, job.payload.deliveryId, now())) return;
        } catch {
          report({ kind: job.kind, outcome: 'failed', category: 'configuration' });
          return;
        }
      }
      const snapshot = deps.repo.deliveryTarget(job.userId);
      if (!snapshot || snapshot.targetId !== job.targetId) {
        finishFailure(job, 'configuration');
        return;
      }

      let target;
      try {
        // Re-resolve every delivery: a hostname that changed from public to
        // private after save is refused, and the chosen public answer is pinned.
        target = await resolveWebhookTarget(snapshot.url, deps.resolver);
      } catch (error) {
        const category: AccountWebhookFailureCategory =
          error instanceof WebhookUrlError
            ? error.category === 'blocked-target'
              ? 'blocked-target'
              : error.category === 'dns'
                ? 'dns'
                : 'configuration'
            : 'dns';
        finishFailure(job, category);
        return;
      }
      // A user may disable/clear while DNS validation is in flight. Honor that
      // choice before opening a socket.
      if (
        !isUserActive(job.userId) ||
        !deps.repo.matchesEnabledTarget(job.userId, job.targetId)
      ) {
        finishFailure(job, 'configuration');
        return;
      }

      let category: AccountWebhookFailureCategory | null;
      try {
        const result = await transport.post(target, JSON.stringify(job.payload), job.payload.deliveryId);
        category = categoryForStatus(result.statusCode);
      } catch (error) {
        category = error instanceof UserWebhookTransportError ? error.category : 'network';
      }
      const outcome = category == null ? 'delivered' : 'failed';
      try {
        deps.repo.finishDelivery(job.userId, job.payload.deliveryId, outcome, category, now());
      } catch {
        // Claim/attempt remains pending and no retry is scheduled.
      }
      report({ kind: job.kind, outcome, category });
    } catch {
      // Last-resort isolation: no queue job may reject into a watcher/digest
      // loop. Unknown failures stay inside the fixed network category.
      finishFailure(job, 'network');
    }
  };

  const drain = (): void => {
    drainScheduled = false;
    while (active < maxConcurrent && queue.length > 0) {
      const job = queue.shift()!;
      active += 1;
      void run(job).finally(() => {
        active -= 1;
        scheduleDrain();
        settleIdle();
      });
    }
    settleIdle();
  };

  const scheduleDrain = (): void => {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(drain);
  };

  return {
    enqueue(userId, payload, preclaimed = false) {
      if (!isUserActive(userId)) return 'disabled';
      const targetId = deps.repo.enabledTargetId(userId);
      if (!targetId) return 'disabled';
      const kind = kindFor(payload);
      if (queue.length + active >= maxPending) {
        // Keep synchronous watcher work memory-only. Persist/report the drop in
        // a microtask so a full/slow webhook store cannot block account reads.
        queueMicrotask(() => {
          try {
            if (
              isUserActive(userId) &&
              deps.repo.matchesEnabledTarget(userId, targetId)
            ) {
              deps.repo.noteFailure(userId, kind, 'queue-full', payload.deliveryId, now());
            }
          } catch {
            /* fixed status unavailable; still no retry */
          }
          report({ kind, outcome: 'failed', category: 'queue-full' });
        });
        return 'full';
      }
      queue.push({ userId, kind, payload, targetId, preclaimed });
      scheduleDrain();
      return 'queued';
    },
    whenIdle() {
      if (active === 0 && queue.length === 0 && !drainScheduled) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    pending: () => queue.length + active,
  };
}
