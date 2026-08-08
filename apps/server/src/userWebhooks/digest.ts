import { createHash } from 'node:crypto';
import { composeRecapEvidence } from '../recap';
import type { DataProvider } from '../providers';
import type { EquityRepo } from '../equity';
import { completedDigestWindow } from './cadence';
import type { UserWebhookDispatcher } from './delivery';
import { buildDigestWebhookPayload } from './payload';
import type { UserWebhookRepo } from './repo';

export interface UserDigestHandle {
  /** Run one cadence check; exposed for deterministic tests. */
  tick(): Promise<void>;
  stop(): void;
}

function digestAttemptId(targetId: string, windowEnd: number): string {
  // The random endpoint generation provides per-target uniqueness without
  // placing even a reversible derivative of the internal user id in payloads.
  const digest = createHash('sha256')
    .update(`midas-user-digest-v1\0${targetId}\0${windowEnd}`)
    .digest('hex')
    .slice(0, 32);
  return `digest-v1-${digest}`;
}

/**
 * Restart-safe personal digest scheduler. A fixed cadence window is claimed
 * durably before any account read or outbound enqueue. A crash can therefore
 * leave an honest pending/unknown attempt, but can never replay that window.
 */
export function createUserDigestLoop(deps: {
  repo: UserWebhookRepo;
  dispatcher: UserWebhookDispatcher;
  providerFor: (userId: string) => DataProvider | null;
  equityRepoFor: (userId: string) => EquityRepo | null;
  digestHours: number;
  maxUsers: number;
  now?: () => number;
  /** Auth ownership check; inactive users are skipped before claims or account reads. */
  isUserActive?: (userId: string) => boolean;
  /** Fixed-shape operational hooks; callers must not include user identifiers. */
  onError?: (error: unknown) => void;
  onCapacity?: (omittedUsers: number) => void;
  pollMs?: number;
}): UserDigestHandle {
  const now = deps.now ?? Date.now;
  const maxUsers = Number.isFinite(deps.maxUsers) ? Math.max(0, Math.floor(deps.maxUsers)) : 0;
  let running = false;
  let stopped = false;
  let capacityReportedWindowEnd: number | null = null;
  const reportError = (error: unknown): void => {
    try {
      deps.onError?.(error);
    } catch {
      // Operational hooks are not digest authority.
    }
  };
  const reportCapacity = (omittedUsers: number): void => {
    try {
      deps.onCapacity?.(omittedUsers);
    } catch {
      // Operational hooks are not digest authority.
    }
  };
  const isUserActive = (userId: string): boolean => {
    try {
      return deps.isUserActive?.(userId) ?? true;
    } catch {
      return false;
    }
  };

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const at = now();
      const window = completedDigestWindow(at, deps.digestHours);
      if (!window) return;
      const enabled = deps.repo.enabledUserIds().filter(isUserActive);
      if (enabled.length > maxUsers && capacityReportedWindowEnd !== window.end) {
        capacityReportedWindowEnd = window.end;
        reportCapacity(enabled.length - maxUsers);
      }

      // Account reads are serialized as a second bound beneath the shared
      // outbound queue. A large tenant set cannot stampede an exchange.
      for (const userId of enabled.slice(0, maxUsers)) {
        const targetId = deps.repo.enabledTargetId(userId);
        if (!targetId) continue;
        const attemptId = digestAttemptId(targetId, window.end);
        let claimed = false;
        try {
          claimed = deps.repo.claimDigest(userId, window.end, attemptId, at);
        } catch (error) {
          reportError(error);
          continue;
        }
        if (!claimed) continue;

        try {
          const provider = deps.providerFor(userId);
          const equity = deps.equityRepoFor(userId);
          const evidence = await composeRecapEvidence(
            provider,
            equity ? () => equity.points() : null,
            window.start,
            window.end,
          );
          const payload = buildDigestWebhookPayload(window, evidence, attemptId);
          const queued = deps.dispatcher.enqueue(userId, payload, true);
          if (queued === 'disabled') {
            try {
              deps.repo.finishDelivery(userId, attemptId, 'failed', 'configuration', now());
            } catch {
              // The durable claim remains the no-duplicate authority.
            }
          }
        } catch (error) {
          try {
            deps.repo.finishDelivery(userId, attemptId, 'failed', 'configuration', now());
          } catch {
            // If status persistence fails, leave the durable claim pending.
          }
          reportError(error);
        }
      }
    } catch (error) {
      reportError(error);
    } finally {
      running = false;
    }
  };

  const cadenceMs = completedDigestWindow(now(), deps.digestHours)?.intervalMs ?? 60_000;
  const pollMs = Math.max(1_000, Math.min(deps.pollMs ?? 60_000, cadenceMs));
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  // Catch the first completed window after a restart without waiting for the
  // poll period. configure/enable watermarks prevent historical backfill.
  queueMicrotask(() => void tick());

  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
