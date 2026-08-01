import type { AccountFill, AccountPosition, OpenOrder } from '@midas/shared';

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

export interface AccountRowMapping<T> {
  rows: T[];
  inputValid: boolean;
  attempted: number;
  omitted: number;
}

/**
 * Map a ccxt `fetchOpenOrders()` array to OpenOrder[]: newest first, with a
 * quote-notional value (price × amount). Pure and defensive — unknown/missing
 * required numeric evidence is omitted rather than fabricated as zero.
 */
export function mapOpenOrdersWithDiagnostics(raw: unknown): AccountRowMapping<OpenOrder> {
  if (!Array.isArray(raw)) return { rows: [], inputValid: false, attempted: 0, omitted: 0 };
  const out: OpenOrder[] = [];
  let omitted = 0;
  for (const o of raw) {
    const ord = o as Record<string, unknown>;
    const id = str(ord.id) || str(ord.clientOrderId);
    const symbol = str(ord.symbol);
    const side = ord.side === 'buy' || ord.side === 'sell' ? ord.side : null;
    const type = str(ord.type);
    const status = str(ord.status);
    const amount = toNum(ord.amount);
    const price = toNum(ord.price);
    const filled = toNum(ord.filled);
    if (
      !id || !symbol || side === null || !type || !status ||
      amount == null || amount <= 0 || filled == null || filled < 0 || filled > amount
    ) {
      omitted += 1;
      continue;
    }
    out.push({
      id,
      symbol,
      side,
      type,
      price,
      amount,
      filled,
      remaining: toNum(ord.remaining) ?? Math.max(0, amount - filled),
      value: price != null ? price * amount : null,
      timestamp: toNum(ord.timestamp),
      status,
    });
  }
  out.sort(
    (a, b) =>
      (b.timestamp ?? Number.NEGATIVE_INFINITY) - (a.timestamp ?? Number.NEGATIVE_INFINITY),
  );
  return { rows: out, inputValid: true, attempted: raw.length, omitted };
}

export function mapOpenOrders(raw: unknown): OpenOrder[] {
  return mapOpenOrdersWithDiagnostics(raw).rows;
}

/**
 * Map a ccxt `fetchPositions()` array to AccountPosition[]: drops flat (zero-size)
 * entries, sorts by notional, normalizes side. Pure and defensive.
 */
export function mapPositionsWithDiagnostics(raw: unknown): AccountRowMapping<AccountPosition> {
  if (!Array.isArray(raw)) return { rows: [], inputValid: false, attempted: 0, omitted: 0 };
  const out: AccountPosition[] = [];
  let omitted = 0;
  for (const p of raw) {
    const pos = p as Record<string, unknown>;
    const symbol = str(pos.symbol);
    const side = pos.side === 'long' || pos.side === 'short' ? pos.side : null;
    const contracts = toNum(pos.contracts);
    if (contracts === 0) continue; // valid flat position, intentionally excluded
    if (!symbol || side === null || contracts == null) {
      omitted += 1;
      continue;
    }
    out.push({
      symbol,
      side,
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
  out.sort((a, b) => {
    const bNotional = b.notionalUsd == null ? Number.NEGATIVE_INFINITY : Math.abs(b.notionalUsd);
    const aNotional = a.notionalUsd == null ? Number.NEGATIVE_INFINITY : Math.abs(a.notionalUsd);
    return bNotional - aNotional;
  });
  return { rows: out, inputValid: true, attempted: raw.length, omitted };
}

export function mapPositions(raw: unknown): AccountPosition[] {
  return mapPositionsWithDiagnostics(raw).rows;
}

/**
 * Map a ccxt `fetchMyTrades()` array to AccountFill[]: newest first, cost
 * derived from price × amount when the exchange omits it. Pure and defensive.
 */
export function mapMyTradesWithDiagnostics(raw: unknown): AccountRowMapping<AccountFill> {
  if (!Array.isArray(raw)) return { rows: [], inputValid: false, attempted: 0, omitted: 0 };
  const out: AccountFill[] = [];
  let omitted = 0;
  for (const t of raw) {
    const fill = t as Record<string, unknown>;
    const id = str(fill.id);
    const symbol = str(fill.symbol);
    const side = fill.side === 'buy' || fill.side === 'sell' ? fill.side : null;
    const price = toNum(fill.price);
    const amount = toNum(fill.amount);
    if (!id || !symbol || side === null || price == null || price <= 0 || amount == null || amount <= 0) {
      omitted += 1;
      continue;
    }
    const fee = fill.fee as { cost?: unknown; currency?: unknown } | undefined;
    out.push({
      id,
      orderId: str(fill.order) || null,
      symbol,
      side,
      price,
      amount,
      cost: toNum(fill.cost) ?? price * amount,
      fee: toNum(fee?.cost),
      feeCurrency: str(fee?.currency) || null,
      takerOrMaker: str(fill.takerOrMaker) || null,
      timestamp: toNum(fill.timestamp),
    });
  }
  out.sort(
    (a, b) =>
      (b.timestamp ?? Number.NEGATIVE_INFINITY) - (a.timestamp ?? Number.NEGATIVE_INFINITY),
  );
  return { rows: out, inputValid: true, attempted: raw.length, omitted };
}

export function mapMyTrades(raw: unknown): AccountFill[] {
  return mapMyTradesWithDiagnostics(raw).rows;
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

/**
 * Merge account rows from two venues into one honest list: every row tagged
 * with where it came from, re-sorted by the given key (nulls sink). Pure —
 * the provider decides what to do when one venue fails; this only merges.
 */
export function mergeVenueRows<T extends { venue?: string }>(
  primary: T[],
  primaryVenue: string,
  secondary: T[],
  secondaryVenue: string,
  sortKey: (row: T) => number | null,
): T[] {
  const tagged = [
    ...primary.map((r) => ({ ...r, venue: primaryVenue })),
    ...secondary.map((r) => ({ ...r, venue: secondaryVenue })),
  ];
  tagged.sort((a, b) => (sortKey(b) ?? -Infinity) - (sortKey(a) ?? -Infinity));
  return tagged;
}
