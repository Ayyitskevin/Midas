/**
 * Size / notional conversion. Four linked quantities describe the same
 * position — base quantity, notional (quote/USD), % of account, and margin at
 * a chosen leverage. The user edits any one (the canonical field) and the rest
 * derive from it through the notional. Each derived value is independent: a
 * missing price only blanks quantity, a missing account only blanks the %.
 * Pure and side-effect free for unit testing.
 */

export type SizeField = 'qty' | 'notional' | 'pct' | 'margin';

export interface SizeInputs {
  /** Which field the user last edited — the source of truth. */
  field: SizeField;
  value: number;
  price: number;
  account: number;
  /** Leverage multiplier; ≤0 or non-finite is treated as 1× (spot). */
  leverage: number;
}

export interface SizeResult {
  /** True when a finite notional could be derived from the canonical field. */
  valid: boolean;
  qty: number;
  notional: number;
  pct: number;
  margin: number;
  /** The effective leverage actually used (after the ≥1 guard). */
  leverage: number;
}

const BLANK: Omit<SizeResult, 'leverage'> = { valid: false, qty: NaN, notional: NaN, pct: NaN, margin: NaN };

export function convertSize({ field, value, price, account, leverage }: SizeInputs): SizeResult {
  const lev = Number.isFinite(leverage) && leverage > 0 ? leverage : 1;
  const hasPrice = Number.isFinite(price) && price > 0;
  const hasAccount = Number.isFinite(account) && account > 0;

  if (!Number.isFinite(value)) return { ...BLANK, leverage: lev };

  // Reduce the canonical field to a notional; some fields need price/account.
  let notional = NaN;
  switch (field) {
    case 'qty':
      if (hasPrice) notional = value * price;
      break;
    case 'notional':
      notional = value;
      break;
    case 'pct':
      if (hasAccount) notional = (value / 100) * account;
      break;
    case 'margin':
      notional = value * lev;
      break;
  }

  if (!Number.isFinite(notional)) return { ...BLANK, leverage: lev };

  return {
    valid: true,
    notional,
    qty: hasPrice ? notional / price : NaN,
    pct: hasAccount ? (notional / account) * 100 : NaN,
    margin: notional / lev,
    leverage: lev,
  };
}

/** The four-way value for a given field out of a result (NaN if unavailable). */
export function fieldValue(r: SizeResult, f: SizeField): number {
  return f === 'qty' ? r.qty : f === 'notional' ? r.notional : f === 'pct' ? r.pct : r.margin;
}
