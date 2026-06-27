/**
 * Relative Momentum Index (Roger Altman, 1993).
 *
 * RSI generalised: instead of the 1-bar change, it counts the M-bar momentum,
 * then Wilder-smooths the up/down moves over N bars exactly like RSI:
 *
 *   change[i] = close[i] − close[i−M]
 *   avgGain   = Wilder-smoothed max(change, 0)     over N
 *   avgLoss   = Wilder-smoothed max(−change, 0)    over N
 *   RMI       = 100 · avgGain / (avgGain + avgLoss)   (≡ 100 − 100/(1+RS))
 *
 * Looking back M bars instead of 1 makes RMI smoother and less whippy than RSI
 * while keeping the same 0–100 scale and > 70 / < 30 overbought-oversold reads.
 * With M = 1 it is identical to a standard N-period Wilder RSI. The smoothing is
 * the same form as the app's shared rsi() helper, so the two agree. When the
 * window has no momentum at all (avgGain = avgLoss = 0) it reads a neutral 50.
 *
 * Defaults are Altman's original: length N = 20, momentum M = 5. Verified
 * against an independent worked example. Pure and synchronous.
 */

export type RmiZone = 'ob' | 'os' | 'mid';
export type RmiDir = 'up' | 'down';

export interface RmiStats {
  /** Relative Momentum Index at the latest bar (0–100). */
  rmi: number;
  /** RMI one bar back, for slope / direction. */
  prev: number;
  /** RMI rising (rmi ≥ prev) or falling. */
  dir: RmiDir;
  /** ≥ 70 overbought, ≤ 30 oversold, otherwise mid. */
  zone: RmiZone;
  /** Number of closes supplied. */
  n: number;
}

export interface RmiRow extends RmiStats {
  symbol: string;
}

export type RmiSort = 'rmi' | 'slope' | 'symbol';

/**
 * Compute the latest Relative Momentum Index for one symbol. Returns null with
 * bad params or too little history (needs ≥ momentum + length closes so the
 * M-bar change series can seed the N-bar Wilder average).
 */
export function computeRmi(closes: number[], length = 20, momentum = 5): RmiStats | null {
  if (length < 1 || momentum < 1) return null;
  const n = closes.length;
  if (n < momentum + length) return null;

  // Seed avgGain / avgLoss over the first N M-bar changes (indices M..M+N-1).
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = momentum; i < momentum + length; i++) {
    const ch = closes[i] - closes[i - momentum];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= length;
  avgLoss /= length;

  const calc = () => {
    const s = avgGain + avgLoss;
    return s === 0 ? 50 : (100 * avgGain) / s;
  };

  let rmi = calc();
  let prev = rmi;
  for (let i = momentum + length; i < n; i++) {
    const ch = closes[i] - closes[i - momentum];
    const gain = ch >= 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    prev = rmi;
    rmi = calc();
  }

  const zone: RmiZone = rmi >= 70 ? 'ob' : rmi <= 30 ? 'os' : 'mid';
  return { rmi, prev, dir: rmi >= prev ? 'up' : 'down', zone, n };
}

/** Build a sorted per-symbol RMI board, skipping symbols with too little history. */
export function rmiBoard(
  series: { symbol: string; closes: number[] }[],
  sort: RmiSort = 'rmi',
  length = 20,
  momentum = 5,
): RmiRow[] {
  const rows: RmiRow[] = [];
  for (const s of series) {
    const stats = computeRmi(s.closes, length, momentum);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRmi(rows, sort);
}

export function sortRmi(rows: RmiRow[], sort: RmiSort): RmiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
      out.sort((a, b) => b.rmi - b.prev - (a.rmi - a.prev));
      break;
    case 'rmi':
    default:
      // Most overbought first.
      out.sort((a, b) => b.rmi - a.rmi);
      break;
  }
  return out;
}
