import type { AccountFill } from '@midas/shared';

/**
 * Post-trade slippage: realized fill prices vs the estimate TICKET showed at
 * placement. The baseline only exists in the browser that placed the order
 * (the preview is client-side), so this is honestly best-effort: fills placed
 * elsewhere simply have no baseline. Pure — the store persists, this computes.
 */

export interface FillBaseline {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** TICKET's estimated average fill price at placement. */
  estPrice: number;
  /** Epoch millis recorded. */
  at: number;
}

/** Add a baseline, evicting the oldest entries beyond the cap. Returns a new map. */
export function recordBaseline(
  map: Record<string, FillBaseline>,
  b: FillBaseline,
  cap = 200,
): Record<string, FillBaseline> {
  if (!b.orderId || !(b.estPrice > 0)) return map;
  const next = { ...map, [b.orderId]: b };
  const ids = Object.keys(next);
  if (ids.length <= cap) return next;
  for (const id of ids
    .sort((a, z) => next[a].at - next[z].at)
    .slice(0, ids.length - cap)) {
    delete next[id];
  }
  return next;
}

/**
 * Signed slippage in basis points — positive is always WORSE for the trader:
 * a buy that filled above the estimate, or a sell that filled below it.
 */
export function slippageBps(side: 'buy' | 'sell', estPrice: number, realizedPrice: number): number | null {
  if (!(estPrice > 0) || !(realizedPrice > 0)) return null;
  const raw = ((realizedPrice - estPrice) / estPrice) * 10_000;
  return side === 'buy' ? raw : -raw;
}

/** Per-fill slippage vs its order's recorded baseline; null when there is none. */
export function fillSlippageBps(
  fill: Pick<AccountFill, 'orderId' | 'price' | 'side'>,
  baselines: Record<string, FillBaseline>,
): number | null {
  if (!fill.orderId) return null;
  const base = baselines[fill.orderId];
  if (!base) return null;
  return slippageBps(fill.side, base.estPrice, fill.price);
}

/** Compact display: '+3.2bp' (worse, red) / '-1.4bp' (better, green). */
export function fmtBps(bps: number): string {
  const r = Math.round(bps * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}bp`;
}
