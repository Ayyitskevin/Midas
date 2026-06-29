import type { AccountPosition, OpenOrder } from '@midas/shared';

/**
 * Read-only account-read mappers (open orders & positions) for the ccxt path.
 * Midas is non-custodial and read-only: the provider calls only fetchOpenOrders
 * and fetchPositions — never createOrder, cancelOrder or editOrder. These
 * mappings are pure and unit-tested against fixtures so they can be verified
 * without a live exchange (the operator verifies the keyed reads themselves).
 */

const toNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Map a ccxt `fetchOpenOrders()` array to OpenOrder[]: newest first, with a
 * quote-notional value (price × amount). Pure and defensive — unknown/missing
 * fields degrade to sensible defaults rather than throwing.
 */
export function mapOpenOrders(raw: unknown): OpenOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenOrder[] = [];
  for (const o of raw) {
    const ord = o as Record<string, unknown>;
    const amount = toNum(ord.amount) ?? 0;
    const price = toNum(ord.price);
    const filled = toNum(ord.filled) ?? 0;
    out.push({
      id: str(ord.id) || str(ord.clientOrderId) || '—',
      symbol: str(ord.symbol),
      side: ord.side === 'sell' ? 'sell' : 'buy',
      type: str(ord.type) || 'limit',
      price,
      amount,
      filled,
      remaining: toNum(ord.remaining) ?? Math.max(0, amount - filled),
      value: price != null ? price * amount : null,
      timestamp: toNum(ord.timestamp),
      status: str(ord.status) || 'open',
    });
  }
  out.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return out;
}

/**
 * Map a ccxt `fetchPositions()` array to AccountPosition[]: drops flat (zero-size)
 * entries, sorts by notional, normalizes side. Pure and defensive.
 */
export function mapPositions(raw: unknown): AccountPosition[] {
  if (!Array.isArray(raw)) return [];
  const out: AccountPosition[] = [];
  for (const p of raw) {
    const pos = p as Record<string, unknown>;
    const contracts = toNum(pos.contracts);
    if (contracts == null || contracts === 0) continue; // skip flat positions
    out.push({
      symbol: str(pos.symbol),
      side: pos.side === 'short' ? 'short' : 'long',
      contracts: Math.abs(contracts),
      notionalUsd: toNum(pos.notional),
      entryPrice: toNum(pos.entryPrice),
      markPrice: toNum(pos.markPrice),
      unrealizedPnlUsd: toNum(pos.unrealizedPnl),
      pnlPct: toNum(pos.percentage),
      liquidationPrice: toNum(pos.liquidationPrice),
      leverage: toNum(pos.leverage),
    });
  }
  out.sort((a, b) => Math.abs(b.notionalUsd ?? 0) - Math.abs(a.notionalUsd ?? 0));
  return out;
}

/** Sum unrealized P&L across positions; null when none report a P&L. */
export function sumUnrealizedPnl(positions: AccountPosition[]): number | null {
  let sum = 0;
  let any = false;
  for (const p of positions) {
    if (p.unrealizedPnlUsd != null) {
      sum += p.unrealizedPnlUsd;
      any = true;
    }
  }
  return any ? sum : null;
}
