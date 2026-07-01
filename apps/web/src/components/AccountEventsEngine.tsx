import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useToasts } from '@/store/useToasts';
import { emitAccountChange } from '@/lib/accountBus';
import { eventBody, eventHeadline, eventTone } from '@/lib/accountEvents';

const POLL_MS = 10_000;
/** When the server says the watcher is off, check back this much less often. */
const IDLE_SKIP = 6; // 6 × POLL_MS = every minute

/**
 * Invisible, app-mounted poll of the server's account event feed (order
 * placed / filled / canceled, observed by the read-only account watcher).
 * Each new event becomes a toast, and any event nudges the account panels
 * (ORD / FILLS / BAL / POSN) to refresh via the account bus.
 *
 * The first successful poll only records the feed cursor — events that
 * happened before this browser session are never replayed as toasts.
 */
export function AccountEventsEngine() {
  const inFlight = useRef(false);
  const lastSeen = useRef<number | null>(null);
  const idleTicks = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function tick(): Promise<void> {
      if (inFlight.current) return;
      if (idleTicks.current > 0) {
        idleTicks.current -= 1;
        return;
      }
      inFlight.current = true;
      try {
        const feed = await api.accountEvents(lastSeen.current ?? undefined, controller.signal);
        if (cancelled) return;
        if (!feed.watching) {
          idleTicks.current = IDLE_SKIP;
          return;
        }
        if (lastSeen.current === null) {
          lastSeen.current = feed.latestId; // baseline — no replay
          return;
        }
        lastSeen.current = Math.max(lastSeen.current, feed.latestId);
        if (feed.events.length === 0) return;
        const push = useToasts.getState().push;
        for (const e of feed.events) {
          push({ title: eventHeadline(e), body: eventBody(e), tone: eventTone(e) });
        }
        emitAccountChange(); // fills/cancels change ORD, FILLS, BAL, POSN
      } catch {
        /* server unreachable this tick */
      } finally {
        inFlight.current = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return null;
}
