import type { Position, Transaction } from '@/store/usePortfolio';

/** Portable, versioned snapshot of a paper portfolio for file import/export. */
export interface PortfolioExport {
  /** Magic marker so we can recognise our own files on import. */
  midas: 'portfolio';
  version: 1;
  realized: number;
  positions: Position[];
  transactions: Transaction[];
}

export function buildPortfolioExport(
  realized: number,
  positions: Position[],
  transactions: Transaction[],
): PortfolioExport {
  return { midas: 'portfolio', version: 1, realized, positions, transactions };
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Coerce one untrusted record into a valid Position, or null to drop it. */
function sanitizePosition(raw: unknown, index: number): Position | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const symbol = typeof r.symbol === 'string' ? r.symbol.toUpperCase() : null;
  const quantity = num(r.quantity, NaN);
  const entryPrice = num(r.entryPrice, NaN);
  if (!symbol || !Number.isFinite(quantity) || quantity === 0) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  return {
    id: `pos_imp_${index}`,
    symbol,
    quantity,
    entryPrice,
    note: str(r.note),
    openedAt: num(r.openedAt, 0),
  };
}

/** Coerce one untrusted record into a valid Transaction, or null to drop it. */
function sanitizeTransaction(raw: unknown, index: number): Transaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const symbol = typeof r.symbol === 'string' ? r.symbol.toUpperCase() : null;
  const quantity = num(r.quantity, NaN);
  const price = num(r.price, NaN);
  if (!symbol || !Number.isFinite(quantity) || quantity === 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    id: `tx_imp_${index}`,
    symbol,
    quantity,
    price,
    realized: num(r.realized, 0),
    note: str(r.note),
    at: num(r.at, 0),
  };
}

/** The portfolio slice synced to the server (one opaque blob per user). */
export interface PortfolioSnapshot {
  realized: number;
  positions: Position[];
  transactions: Transaction[];
}

/**
 * Coerce an untrusted server blob into a PortfolioSnapshot, or null if unusable.
 * Unlike a file import this needs no magic marker and accepts an empty book — a
 * user who has cleared their positions still has a valid, syncable state.
 */
export function parsePortfolioSnapshot(data: unknown): PortfolioSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const positions: Position[] = [];
  if (Array.isArray(d.positions)) {
    for (const raw of d.positions) {
      const p = sanitizePosition(raw, positions.length);
      if (p) positions.push(p);
    }
  }

  const transactions: Transaction[] = [];
  if (Array.isArray(d.transactions)) {
    for (const raw of d.transactions) {
      const t = sanitizeTransaction(raw, transactions.length);
      if (t) transactions.push(t);
    }
  }

  return { realized: num(d.realized, 0), positions, transactions };
}

/** Validate and normalise a parsed import payload. Throws a friendly error. */
export function parsePortfolioExport(data: unknown): {
  realized: number;
  positions: Position[];
  transactions: Transaction[];
} {
  if (!data || typeof data !== 'object') throw new Error('Not a portfolio file');
  const d = data as Record<string, unknown>;
  if (d.midas !== 'portfolio') throw new Error('Not a Midas portfolio file');

  const positions: Position[] = [];
  if (Array.isArray(d.positions)) {
    for (const raw of d.positions) {
      const p = sanitizePosition(raw, positions.length);
      if (p) positions.push(p);
    }
  }

  const transactions: Transaction[] = [];
  if (Array.isArray(d.transactions)) {
    for (const raw of d.transactions) {
      const t = sanitizeTransaction(raw, transactions.length);
      if (t) transactions.push(t);
    }
  }

  if (positions.length === 0 && transactions.length === 0) {
    throw new Error('Portfolio file has no usable positions or trades');
  }

  return { realized: num(d.realized, 0), positions, transactions };
}
