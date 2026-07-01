import type { AccountOrderEvent } from '@midas/shared';
import type { AccountWatchHandle } from './accountWatch';

/**
 * Weekly operator digest — a periodic webhook summary of what the terminal
 * saw while you weren't looking: alerts fired, order flow observed by the
 * account watcher, and the server's identity/version. Off by default
 * (MIDAS_DIGEST_HOURS=0); needs the alert webhook to have anywhere to go.
 *
 * Read-only by construction: it only counts things other loops already
 * observed — it never calls an exchange itself.
 */

export interface DigestInputs {
  /** Epoch millis of the period start (last digest or loop start). */
  sinceMs: number;
  nowMs: number;
  providerName: string;
  providerLive: boolean;
  version: string;
  /** Alert triggers fired during the period. */
  alertsFired: number;
  /** Account order events observed during the period (may be truncated). */
  events: AccountOrderEvent[];
  /** Events that fell out of the watcher's ring buffer before this digest. */
  missedEvents: number;
  /** Whether the account watcher is running at all. */
  watching: boolean;
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** One compact, Discord/Slack-friendly digest message. Pure. */
export function buildDigestText(d: DigestInputs): string {
  const days = Math.max(0, (d.nowMs - d.sinceMs) / 86_400_000);
  const counts: Record<string, number> = { new: 0, fill: 0, filled: 0, canceled: 0, closed: 0 };
  const symbols = new Set<string>();
  for (const e of d.events) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    symbols.add(e.symbol);
  }
  const approx = d.missedEvents > 0 ? '≥' : '';
  const lines = [
    `📊 Midas digest — ${d.providerName} (${d.providerLive ? 'live' : 'synthetic'}), v${d.version}`,
    `• Alerts fired: ${d.alertsFired}`,
  ];
  if (!d.watching) {
    lines.push('• Order flow: account watcher off (set MIDAS_ACCOUNT_WATCH_MS and API keys to include it)');
  } else if (d.events.length === 0 && d.missedEvents === 0) {
    lines.push('• Order flow: no order activity observed');
  } else {
    lines.push(
      `• Order flow: ${approx}${counts.new} new · ${approx}${counts.fill} partial fill${counts.fill === 1 ? '' : 's'} · ` +
        `${approx}${counts.filled} filled · ${approx}${counts.canceled + counts.closed} canceled/closed` +
        (symbols.size > 0 ? ` (${[...symbols].slice(0, 5).join(', ')}${symbols.size > 5 ? ', …' : ''})` : ''),
    );
    if (d.missedEvents > 0) {
      lines.push(`• Note: ${plural(d.missedEvents, 'older event')} aged out of the buffer before this digest — counts are minimums.`);
    }
  }
  lines.push(`Covers the last ${days.toFixed(1)} day${days === 1 ? '' : 's'}.`);
  return lines.join('\n');
}

export interface DigestSourceDeps {
  providerName: string;
  providerLive: boolean;
  version: string;
  /** The account watcher when it is running; null keeps the digest honest about it. */
  watcher: AccountWatchHandle | null;
  /** Injected clock (tests). */
  now?: () => number;
}

export interface DigestSource {
  /** Called by the alert loop's onFire hook. */
  addAlertFires(count: number): void;
  /** Snapshot the period since the last compose (or creation) and reset cursors. */
  compose(): string;
}

/**
 * Stateful collector between digests: accumulates alert-fire counts and keeps
 * an id cursor into the watcher's event buffer, so each digest covers exactly
 * the period since the previous one — including an honest "missed" count when
 * a busy week overflowed the watcher's ring buffer.
 */
export function createDigestSource(deps: DigestSourceDeps): DigestSource {
  const now = deps.now ?? Date.now;
  let sinceMs = now();
  let alertsFired = 0;
  let lastEventId = deps.watcher?.latestId() ?? 0;

  return {
    addAlertFires(count) {
      alertsFired += Math.max(0, count);
    },
    compose() {
      const nowMs = now();
      const events = deps.watcher?.eventsSince(lastEventId) ?? [];
      const latest = deps.watcher?.latestId() ?? lastEventId;
      // Events that existed but fell out of the ring buffer: the id space is
      // contiguous, so anything between the cursor and the oldest retained
      // event was observed-but-forgotten.
      const missedEvents = Math.max(0, latest - lastEventId - events.length);
      const text = buildDigestText({
        sinceMs,
        nowMs,
        providerName: deps.providerName,
        providerLive: deps.providerLive,
        version: deps.version,
        alertsFired,
        events,
        missedEvents,
        watching: deps.watcher != null,
      });
      sinceMs = nowMs;
      alertsFired = 0;
      lastEventId = latest;
      return text;
    },
  };
}

export interface DigestLoop {
  stop(): void;
}

/** Compose + deliver on a period timer (same shape as the alert loop). */
export function startDigestLoop(
  source: DigestSource,
  intervalMs: number,
  notify: (text: string) => void,
  onError?: (err: unknown) => void,
): DigestLoop {
  const timer = setInterval(() => {
    try {
      notify(source.compose());
    } catch (err) {
      onError?.(err);
    }
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
