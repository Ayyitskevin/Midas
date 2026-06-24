import { evaluateAlerts, type AlertTrigger, type Readings } from '@midas/shared';
import type { DataProvider } from '../providers';
import type { AlertRepo } from './repo';

/**
 * Run one evaluation pass: gather the readings the active alerts need, evaluate
 * via the shared engine, persist the updated rules, and return what fired.
 */
export async function evaluateOnce(
  repo: AlertRepo,
  provider: DataProvider,
  now: number,
): Promise<AlertTrigger[]> {
  const all = repo.list();
  const active = all.filter((a) => a.enabled);
  if (active.length === 0) return [];

  const quoteSyms = [
    ...new Set(
      active.filter((a) => a.metric === 'price' || a.metric === 'change').map((a) => a.symbol),
    ),
  ];
  const fundSyms = [...new Set(active.filter((a) => a.metric === 'funding').map((a) => a.symbol))];

  const readings: Readings = {};
  if (quoteSyms.length > 0) {
    try {
      const quotes = await provider.getQuotes(quoteSyms);
      for (const q of quotes) {
        const r = (readings[q.symbol.toUpperCase()] ??= {});
        r.price = q.price;
        r.change = q.changePercent;
      }
    } catch {
      /* leave those symbols unread this pass */
    }
  }
  for (const sym of fundSyms) {
    try {
      const d = await provider.getDerivatives(sym);
      if (d.fundingRate != null) (readings[sym] ??= {}).funding = d.fundingRate * 100;
    } catch {
      /* skip */
    }
  }

  const { next, fired } = evaluateAlerts(all, readings, now);
  repo.commit(next, fired);
  return fired;
}

export interface AlertLoop {
  stop: () => void;
}

/** Start a periodic evaluation loop. Returns a handle to stop it. */
export function startAlertLoop(
  repo: AlertRepo,
  provider: DataProvider,
  intervalMs: number,
  onFire?: (fired: AlertTrigger[]) => void,
  onError?: (err: unknown) => void,
): AlertLoop {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const fired = await evaluateOnce(repo, provider, Date.now());
      if (fired.length > 0 && onFire) onFire(fired);
    } catch (err) {
      onError?.(err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
