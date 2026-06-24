/**
 * Trade P&L and fee math — pure, synchronous, offline. Given an entry/exit, a
 * size and per-side fee rates, it returns gross and net P&L, the fees paid,
 * return-on-equity (against margin when leveraged, else notional) and the exit
 * price that breaks even *after* fees. Complements the RISK sizer (which sizes
 * a trade) and the DCA module (which blends entries).
 */

export type TradeSide = 'long' | 'short';

export interface PnlInput {
  side: TradeSide;
  entry: number;
  exit: number;
  size: number;
  /** Entry-side fee, percent of entry notional (e.g. 0.05 = 0.05%). */
  entryFeePct: number;
  /** Exit-side fee, percent of exit notional. */
  exitFeePct: number;
  /** Optional leverage; values ≤ 1 are treated as spot (margin = notional). */
  leverage?: number | null;
}

export interface PnlResult {
  valid: boolean;
  reason: string | null;
  side: TradeSide;
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  totalFees: number;
  netPnl: number;
  entryNotional: number;
  exitNotional: number;
  /** Capital committed — notional / leverage, or full notional for spot. */
  margin: number;
  grossRoePct: number;
  netRoePct: number;
  /** Exit price at which net P&L is zero, after both fees. */
  breakEvenPrice: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function computePnl(input: PnlInput): PnlResult {
  const { side, entry, exit, size } = input;
  const dir = side === 'long' ? 1 : -1;
  // Fees as fractions, clamped to a sane range so break-even can't divide by ~0.
  const f1 = clamp(input.entryFeePct / 100, 0, 0.99);
  const f2 = clamp(input.exitFeePct / 100, 0, 0.99);
  const leverage = input.leverage != null && input.leverage > 1 ? input.leverage : null;

  const invalid = (reason: string): PnlResult => ({
    valid: false,
    reason,
    side,
    grossPnl: 0,
    entryFee: 0,
    exitFee: 0,
    totalFees: 0,
    netPnl: 0,
    entryNotional: 0,
    exitNotional: 0,
    margin: 0,
    grossRoePct: 0,
    netRoePct: 0,
    breakEvenPrice: 0,
  });

  if (!(entry > 0)) return invalid('Entry price must be positive.');
  if (!(exit > 0)) return invalid('Exit price must be positive.');
  if (!(size > 0)) return invalid('Size must be positive.');

  const entryNotional = entry * size;
  const exitNotional = exit * size;
  const entryFee = entryNotional * f1;
  const exitFee = exitNotional * f2;
  const totalFees = entryFee + exitFee;

  const grossPnl = dir * (exit - entry) * size;
  const netPnl = grossPnl - totalFees;

  const margin = leverage ? entryNotional / leverage : entryNotional;
  const grossRoePct = margin > 0 ? (grossPnl / margin) * 100 : 0;
  const netRoePct = margin > 0 ? (netPnl / margin) * 100 : 0;

  // Solve net P&L = 0 for the exit price, fees included.
  const breakEvenPrice = dir === 1 ? (entry * (1 + f1)) / (1 - f2) : (entry * (1 - f1)) / (1 + f2);

  return {
    valid: true,
    reason: null,
    side,
    grossPnl,
    entryFee,
    exitFee,
    totalFees,
    netPnl,
    entryNotional,
    exitNotional,
    margin,
    grossRoePct,
    netRoePct,
    breakEvenPrice,
  };
}
