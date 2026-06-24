import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useAlerts } from '@/store/useAlerts';
import { useToasts } from '@/store/useToasts';
import { notifyTrigger, playBeep, type Readings } from '@/lib/alerts';

const POLL_MS = 4000;

/**
 * Invisible, app-mounted loop that evaluates alerts against fresh market data
 * even when no alerts panel is open. Polls quotes (and derivatives for funding
 * alerts) every few seconds, folds them through the store, and fires a toast /
 * Web Notification / beep for each crossing.
 */
export function AlertsEngine() {
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function tick() {
      if (inFlight.current) return;
      const active = useAlerts.getState().alerts.filter((a) => a.enabled);
      if (active.length === 0) return;

      inFlight.current = true;
      try {
        const priceSyms = [...new Set(active.filter((a) => a.metric === 'price').map((a) => a.symbol))];
        const fundSyms = [...new Set(active.filter((a) => a.metric === 'funding').map((a) => a.symbol))];

        const readings: Readings = {};
        const tasks: Promise<void>[] = [];

        if (priceSyms.length > 0) {
          tasks.push(
            api
              .quotes(priceSyms, controller.signal)
              .then((quotes) => {
                for (const q of quotes) {
                  (readings[q.symbol.toUpperCase()] ??= {}).price = q.price;
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

        const fired = useAlerts.getState().ingest(readings);
        if (fired.length === 0) return;

        const push = useToasts.getState().push;
        for (const t of fired) {
          push({
            title: `${t.symbol} alert`,
            body: `${t.metric} ${t.op === 'above' ? '≥' : '≤'} ${t.value}${t.metric === 'funding' ? '%' : ''}`,
            tone: t.op === 'above' ? 'up' : 'down',
          });
          notifyTrigger(t);
        }
        if (useAlerts.getState().soundEnabled) playBeep();
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
