import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useAlerts } from '@/store/useAlerts';
import { useToasts } from '@/store/useToasts';
import { useSettings } from '@/store/useSettings';
import {
  newTriggersSince,
  notifyTrigger,
  playBeep,
  triggerHeadline,
  triggerBody,
  type AlertTrigger,
  type Readings,
} from '@/lib/alerts';

const POLL_MS = 4000;

function toneFor(t: AlertTrigger): 'up' | 'down' | 'info' {
  return t.op === 'cross' ? 'info' : t.op === 'above' ? 'up' : 'down';
}

/**
 * Invisible, app-mounted loop. In **local** mode it evaluates alerts against
 * fresh market data client-side; in **server** mode the server evaluates and
 * this just polls the trigger log to surface fires the user hasn't seen yet.
 * Either way a fire becomes a toast / Web Notification / beep.
 */
export function AlertsEngine() {
  const inFlight = useRef(false);
  const prevMode = useRef<string>('');
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const announce = (fired: AlertTrigger[]): void => {
      const push = useToasts.getState().push;
      const desktopOn = useSettings.getState().settings.desktopNotifications;
      for (const t of fired) {
        push({ title: triggerHeadline(t), body: triggerBody(t), tone: toneFor(t) });
        if (desktopOn) notifyTrigger(t);
      }
      if (fired.length > 0 && useAlerts.getState().soundEnabled) playBeep();
    };

    async function tick(): Promise<void> {
      if (inFlight.current) return;
      const mode = useAlerts.getState().mode;
      // Re-baseline so re-entering server mode doesn't replay a backlog.
      if (mode === 'server' && prevMode.current !== 'server') lastSeen.current = null;
      prevMode.current = mode;

      // ---- server mode: poll the trigger log ----
      if (mode === 'server') {
        inFlight.current = true;
        try {
          const log = await api.alertLog(controller.signal);
          if (cancelled) return;
          const fresh = newTriggersSince(log, lastSeen.current);
          lastSeen.current = log[0]?.id ?? lastSeen.current;
          announce(fresh);
        } catch {
          /* server unreachable this tick */
        } finally {
          inFlight.current = false;
        }
        return;
      }

      // ---- local mode: evaluate client-side ----
      const active = useAlerts.getState().alerts.filter((a) => a.enabled);
      if (active.length === 0) return;

      inFlight.current = true;
      try {
        const quoteSyms = [
          ...new Set(active.filter((a) => a.metric === 'price' || a.metric === 'change').map((a) => a.symbol)),
        ];
        const fundSyms = [...new Set(active.filter((a) => a.metric === 'funding').map((a) => a.symbol))];

        const readings: Readings = {};
        const tasks: Promise<void>[] = [];
        if (quoteSyms.length > 0) {
          tasks.push(
            api
              .quotes(quoteSyms, controller.signal)
              .then((quotes) => {
                for (const q of quotes) {
                  const r = (readings[q.symbol.toUpperCase()] ??= {});
                  r.price = q.price;
                  r.change = q.changePercent;
                }
              })
              .catch(() => {}),
          );
        }
        for (const sym of fundSyms) {
          tasks.push(
            api
              .derivatives(sym, controller.signal)
              .then((d) => {
                if (d.fundingRate != null) (readings[sym] ??= {}).funding = d.fundingRate * 100;
              })
              .catch(() => {}),
          );
        }

        await Promise.all(tasks);
        if (cancelled) return;
        announce(useAlerts.getState().ingest(readings));
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
