/**
 * Detrended Price Oscillator (DPO).
 *
 * Strips the trend to expose the price cycle around its average by comparing a
 * *past* close to the current moving average:
 *
 *   shift = floor(N / 2) + 1
 *   DPO   = close[t − shift] − SMA(close, N) at t
 *
 * The shift aligns the past close with the centre of the SMA window, so DPO
 * oscillates around zero with the dominant cycle — positive at cycle highs,
 * negative at cycle lows. Because it reaches *back* (never forward), the
 * screener form has no look-ahead. A cycle-oriented oscillator, distinct from
 * the trend/momentum family.
 *
 * DPO is reported in price units and as a % of the SMA so the board is
 * comparable across symbols. Pure and synchronous for exact unit testing.
 */

export type DpoSide = 'up' | 'down';

export interface DpoStats {
  /** DPO value (past close − SMA), price units. */
  dpo: number;
  /** DPO as a % of the SMA. */
  dpoPct: number;
  /** The N-bar SMA at the latest bar. */
  sma: number;
  /** DPO sign (above / below the detrended zero line). */
  side: DpoSide;
  /** Number of closes supplied. */
  n: number;
}

export interface DpoRow extends DpoStats {
  symbol: string;
}

export type DpoSort = 'dpo' | 'symbol';

/** The DPO look-back shift for a given period. */
export const dpoShift = (period: number) => Math.floor(period / 2) + 1;

/**
 * Compute the latest DPO for one symbol. Needs `max(period, shift + 1)` closes
 * (the SMA window and the shifted past close); returns null otherwise.
 */
export function computeDpo(closes: number[], period = 20): DpoStats | null {
  if (period < 2) return null;
  const n = closes.length;
  const shift = dpoShift(period);
  if (n < Math.max(period, shift + 1)) return null;

  let sum = 0;
  for (let i = n - period; i < n; i++) sum += closes[i];
  const sma = sum / period;

  const past = closes[n - 1 - shift];
  const dpo = past - sma;
  return { dpo, dpoPct: sma !== 0 ? (dpo / sma) * 100 : 0, sma, side: dpo >= 0 ? 'up' : 'down', n };
}

/** Build a sorted per-symbol DPO board, skipping symbols with too little history. */
export function dpoBoard(
  series: { symbol: string; closes: number[] }[],
  sort: DpoSort = 'dpo',
  period = 20,
): DpoRow[] {
  const rows: DpoRow[] = [];
  for (const s of series) {
    const stats = computeDpo(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortDpo(rows, sort);
}

export function sortDpo(rows: DpoRow[], sort: DpoSort): DpoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'dpo':
    default:
      out.sort((a, b) => b.dpoPct - a.dpoPct);
      break;
  }
  return out;
}
