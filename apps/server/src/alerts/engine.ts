import { ACCOUNT_SYMBOL, evaluateAlerts, type AlertTrigger, type Readings } from '@midas/shared';
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
  const all = repo.all();
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

  // Account metrics — one read each, only when such alerts exist, and only
  // honest live values (an unreadable account leaves the symbols unread, so
  // rules stay armed instead of firing on stale/synthetic numbers).
  if (active.some((a) => a.metric === 'upnl')) {
    try {
      const pos = await provider.getPositions();
      if (pos.provenance === 'live') {
        for (const p of pos.positions) {
          if (p.unrealizedPnlUsd == null) continue;
          const sym = p.symbol.toUpperCase();
          (readings[sym] ??= {}).upnl = p.unrealizedPnlUsd;
          // Perp symbols carry a settle suffix (BTC/USDT:USDT) — also serve
          // the rule typed without it, when that doesn't collide.
          const spot = sym.split(':')[0];
          if (spot !== sym && readings[spot]?.upnl == null) (readings[spot] ??= {}).upnl = p.unrealizedPnlUsd;
        }
      }
    } catch {
      /* leave upnl unread this pass */
    }
  }
  if (active.some((a) => a.metric === 'equity')) {
    try {
      const bal = await provider.getBalances();
      if (bal.provenance === 'live' && bal.totalValueUsd != null) {
        (readings[ACCOUNT_SYMBOL] ??= {}).equity = bal.totalValueUsd;
      }
    } catch {
      /* leave equity unread this pass */
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
