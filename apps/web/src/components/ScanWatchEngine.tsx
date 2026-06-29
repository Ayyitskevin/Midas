import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useWatchlist } from '@/store/useWatchlist';
import { useSavedScans } from '@/store/useSavedScans';
import { useScanWatches } from '@/store/useScanWatches';
import { useSettings } from '@/store/useSettings';
import { useToasts } from '@/store/useToasts';
import { useAlerts } from '@/store/useAlerts';
import { signalBoard } from '@/lib/signals';
import { matchingSymbols, newMatches, watchHeadline, watchBody } from '@/lib/scanWatch';
import { canNotify, playBeep } from '@/lib/alerts';

// Daily-timeframe signals move slowly, so poll far less often than the
// price/funding alerts engine (4s) — once a minute is plenty and keeps the
// per-tick watchlist history fetch cheap.
const POLL_MS = 60_000;
const MAX_SYMS = 24;

/**
 * Invisible, app-mounted loop that powers saved-scan watches: each minute it
 * re-runs the watched scans over the watchlist and surfaces *newly* matched
 * symbols as a toast / Web Notification / beep. The first observation of each
 * scan only sets a baseline (no fire), so enabling a watch — or reloading —
 * never replays the symbols that already matched.
 */
export function ScanWatchEngine() {
  const inFlight = useRef(false);
  // Per-scan last-seen matching set; a missing key means "not yet baselined".
  const seen = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function tick(): Promise<void> {
      if (inFlight.current) return;

      const watched = useScanWatches.getState().watched;
      if (watched.length === 0) {
        seen.current.clear();
        return;
      }
      const scans = useSavedScans.getState().scans;
      const active = watched
        .map((name) => scans.find((s) => s.name === name))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      // Forget baselines for scans no longer watched (or deleted).
      for (const key of [...seen.current.keys()]) {
        if (!active.some((s) => s.name === key)) seen.current.delete(key);
      }
      if (active.length === 0) return;

      const syms = useWatchlist.getState().symbols.slice(0, MAX_SYMS);
      if (syms.length === 0) return;

      inFlight.current = true;
      try {
        const series = await Promise.all(
          syms.map((s) =>
            api
              .history(s, '1d', '1y', controller.signal)
              .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
              .catch(() => ({ symbol: s, closes: [] as number[] })),
          ),
        );
        if (cancelled) return;
        const rows = signalBoard(series);

        const push = useToasts.getState().push;
        const desktopOn = useSettings.getState().settings.desktopNotifications;
        let firedAny = false;

        for (const scan of active) {
          const curr = matchingSymbols(rows, scan.criteria);
          const prev = seen.current.get(scan.name);
          seen.current.set(scan.name, curr);
          if (prev === undefined) continue; // first observation → baseline only
          const fresh = newMatches(prev, curr);
          if (fresh.length === 0) continue;
          firedAny = true;
          const title = watchHeadline(scan.name, fresh);
          const body = watchBody(fresh);
          push({ title, body, tone: 'info' });
          if (desktopOn && canNotify() && Notification.permission === 'granted') {
            try {
              new Notification(title, { body, tag: `scan-${scan.name}` });
            } catch {
              /* notifications unavailable in this context */
            }
          }
        }
        if (firedAny && useAlerts.getState().soundEnabled) playBeep();
      } catch {
        /* market data unreachable this tick */
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
