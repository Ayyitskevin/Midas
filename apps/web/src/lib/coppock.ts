/**
 * Coppock Curve (Edwin Coppock).
 *
 * A long-cycle momentum gauge: a linearly-weighted moving average of the sum of
 * two rate-of-change measures.
 *
 *   ROC1 = (close − close[N1 ago]) / close[N1 ago] · 100   (default N1 = 14)
 *   ROC2 = (close − close[N2 ago]) / close[N2 ago] · 100   (default N2 = 11)
 *   Coppock = WMA(ROC1 + ROC2, M)                          (default M = 10)
 *
 * The WMA weights the most recent bar highest (linear weights 1..M). Coppock's
 * classic signal is a zero-line region upturn — the curve troughing and turning
 * up — so we report the value, its zero-line side and a fresh trough/peak turn.
 * A slow, bottom-spotting oscillator, distinct from the fast momentum family.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed closes.
 */

export type CoppockSide = 'up' | 'down';
export type CoppockTurn = 'up' | 'down' | 'none';

export interface CoppockStats {
  /** Latest Coppock value. */
  coppock: number;
  /** Prior bar's Coppock value. */
  prev: number;
  /** Rising vs the prior bar. */
  rising: boolean;
  /** Zero-line side. */
  side: CoppockSide;
  /** Fresh trough (up) / peak (down) turn on the latest bar. */
  turn: CoppockTurn;
  /** Number of closes supplied. */
  n: number;
}

export interface CoppockRow extends CoppockStats {
  symbol: string;
}

export type CoppockSort = 'coppock' | 'symbol';

/**
 * Compute the latest Coppock Curve reading for one symbol. Needs
 * `max(roc1, roc2) + wmaPeriod` closes; returns null otherwise. A `turn`
 * needs three Coppock values.
 */
export function computeCoppock(closes: number[], roc1 = 14, roc2 = 11, wmaPeriod = 10): CoppockStats | null {
  if (roc1 < 1 || roc2 < 1 || wmaPeriod < 1) return null;
  const n = closes.length;
  const maxLb = Math.max(roc1, roc2);
  if (n < maxLb + wmaPeriod) return null;

  // ROC1 + ROC2 per bar, from the first bar with both look-backs available.
  const sum: number[] = [];
  for (let i = maxLb; i < n; i++) {
    const p1 = closes[i - roc1];
    const p2 = closes[i - roc2];
    const r1 = p1 !== 0 ? ((closes[i] - p1) / p1) * 100 : 0;
    const r2 = p2 !== 0 ? ((closes[i] - p2) / p2) * 100 : 0;
    sum.push(r1 + r2);
  }

  // Linearly-weighted MA over the sum series (newest weight = wmaPeriod).
  const denom = (wmaPeriod * (wmaPeriod + 1)) / 2;
  const series: number[] = [];
  for (let end = wmaPeriod - 1; end < sum.length; end++) {
    let num = 0;
    for (let k = 0; k < wmaPeriod; k++) num += (k + 1) * sum[end - wmaPeriod + 1 + k];
    series.push(num / denom);
  }
  if (series.length === 0) return null;

  const last = series.length - 1;
  const coppock = series[last];
  const prev = last >= 1 ? series[last - 1] : coppock;

  let turn: CoppockTurn = 'none';
  if (series.length >= 3) {
    const a = series[last];
    const b = series[last - 1];
    const c = series[last - 2];
    if (b <= c && a > b) turn = 'up';
    else if (b >= c && a < b) turn = 'down';
  }

  return { coppock, prev, rising: coppock > prev, side: coppock >= 0 ? 'up' : 'down', turn, n };
}

/** Build a sorted per-symbol Coppock board, skipping symbols with too little history. */
export function coppockBoard(
  series: { symbol: string; closes: number[] }[],
  sort: CoppockSort = 'coppock',
  roc1 = 14,
  roc2 = 11,
  wmaPeriod = 10,
): CoppockRow[] {
  const rows: CoppockRow[] = [];
  for (const s of series) {
    const stats = computeCoppock(s.closes, roc1, roc2, wmaPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCoppock(rows, sort);
}

export function sortCoppock(rows: CoppockRow[], sort: CoppockSort): CoppockRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'coppock':
    default:
      out.sort((a, b) => b.coppock - a.coppock);
      break;
  }
  return out;
}
