/**
 * Qstick (Tushar Chande).
 *
 * The average candle body over N bars — how consistently price closes above or
 * below its open:
 *
 *   Qstick = SMA(close − open, N)
 *
 * Above zero means up-closes dominated the window (buying bias); below zero
 * means down-closes (selling bias). Raw Qstick is in price units, so the board
 * also reports it as a % of price for cross-symbol comparison. A simple
 * candle-body sentiment gauge.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Bar with open + close (Qstick uses the body). */
export interface QstickBar {
  open: number;
  close: number;
}

export type QstickSide = 'up' | 'down';

export interface QstickStats {
  /** Average body (close − open), price units. */
  qstick: number;
  /** Qstick as a % of the latest close. */
  qstickPct: number;
  /** Body-bias side (sign). */
  side: QstickSide;
  /** Number of bars supplied. */
  n: number;
}

export interface QstickRow extends QstickStats {
  symbol: string;
}

export type QstickSort = 'qstick' | 'symbol';

/**
 * Compute the latest Qstick for one symbol over the last `period` bars. Returns
 * null with too little history.
 */
export function computeQstick(bars: QstickBar[], period = 10): QstickStats | null {
  if (period < 1 || bars.length < period) return null;
  const w = bars.slice(-period);
  let sum = 0;
  for (const b of w) sum += b.close - b.open;
  const qstick = sum / period;
  const close = w[w.length - 1].close;
  return {
    qstick,
    qstickPct: close !== 0 ? (qstick / close) * 100 : 0,
    side: qstick >= 0 ? 'up' : 'down',
    n: bars.length,
  };
}

/** Build a sorted per-symbol Qstick board, skipping symbols with too little history. */
export function qstickBoard(
  series: { symbol: string; bars: QstickBar[] }[],
  sort: QstickSort = 'qstick',
  period = 10,
): QstickRow[] {
  const rows: QstickRow[] = [];
  for (const s of series) {
    const stats = computeQstick(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortQstick(rows, sort);
}

export function sortQstick(rows: QstickRow[], sort: QstickSort): QstickRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'qstick':
    default:
      out.sort((a, b) => b.qstickPct - a.qstickPct);
      break;
  }
  return out;
}
